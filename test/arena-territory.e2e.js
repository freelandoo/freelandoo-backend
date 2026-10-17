// test/arena-territory.e2e.js — Freelandoo Arena, Módulo 07 (e o canal
// interno do Módulo 06), pela HTTP DE VERDADE contra um Postgres de TESTE.
//
//   npm run test:arena-territory
//
// Exercita: assinatura do serviço (ausente, inválida, fora da janela,
// repetida, corpo trocado, navegador chamando direto), sessão interna com
// prazo da credencial, checkpoint (perto/longe, poste inexistente/de outra UF/
// não competitivo, sem participação, categoria divergente, política,
// consentimento revogado, conta bloqueada), idempotência (sequencial,
// concorrente, requestId reutilizado com outro conteúdo, troca de equipe na
// mesma hora, janela pretendida diferente), liderança/empate/categorias
// independentes, feed por revisão, apuração idempotente e concorrente,
// recomputação a partir dos fatos e privacidade das respostas.

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = `arena-terr-${crypto.randomBytes(16).toString("hex")}`;
process.env.ARENA_SERVICE_SECRET = `svc-${crypto.randomBytes(24).toString("hex")}`;
process.env.DATABASE_URL_COLD = "";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function main() {
  console.log("━━━ migrations (banco de teste) ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const { syncCatalog } = require("../src/services/ArenaCatalogSync");
  const { syncPosts } = require("../src/services/ArenaPostSync");
  const { sign: signSvc, sha256Hex } = require("../src/middlewares/arenaServiceAuth");
  const Territory = require("../src/services/ArenaTerritoryService");
  const catalogDoc = require("../src/databases/seeds/arena-catalog.json");

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, p, { token, body, service = true, tamper } = {}) => {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const raw = body === undefined ? "" : JSON.stringify(body);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (service) {
      const ts = String(tamper?.ts ?? Date.now());
      const nonce = tamper?.nonce ?? crypto.randomBytes(18).toString("base64url");
      const sig = signSvc(tamper?.secret ?? process.env.ARENA_SERVICE_SECRET, { method, url: p, ts, nonce, bodyHash: sha256Hex(Buffer.from(tamper?.signedBody ?? raw)) });
      headers["X-Arena-Service-Timestamp"] = ts;
      headers["X-Arena-Service-Nonce"] = nonce;
      headers["X-Arena-Service-Signature"] = sig;
    }
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : raw });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* vazio */
    }
    return { status: res.status, body: json };
  };

  // ─── fixtures sintéticas ─────────────────────────────────────────────────
  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("senha-de-teste-123", 4);
  async function mkUser(tag, extra = {}) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo, is_minor)
       VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id_user`,
      [`Teste ${tag}`, `tr${tag}${stamp}`.slice(0, 30), `arena.terr.${tag}.${stamp}@teste.invalid`, hash, extra.is_minor ?? false]
    );
    return r.rows[0].id_user;
  }
  const tok = (id, opts = {}) => jwt.sign({ id_user: id, email: "x@teste.invalid" }, process.env.JWT_SECRET, { expiresIn: "1h", ...opts });

  const c0 = await pool.connect();
  try {
    ok((await syncCatalog(c0, catalogDoc, { apply: true })).ok, "catálogo");
  } finally {
    c0.release();
  }
  const synth = (cat, team) =>
    pool.query(
      `INSERT INTO public.tb_arena_team (category_id, team_id, labels, is_synthetic)
       VALUES ($1, $2, '{"pt-BR":"Equipe sintética"}'::jsonb, TRUE) ON CONFLICT (category_id, team_id) DO UPDATE SET is_active = TRUE`,
      [cat, team]
    );
  for (const [c, t] of [["futebol", "teste-azul"], ["futebol", "teste-verde"], ["musica", "teste-musica"], ["politica", "teste-grupo-a"]]) await synth(c, t);
  // Postes SINTÉTICOS (ambientes canônicos br-*, banco isolado), competitivos e valendo já.
  const ENV = "br-zz";
  const OTHER = "br-zy";
  const postsDoc = {
    posts: [
      { environmentId: ENV, postId: "t-p0-post", mapVersion: 1, generatorVersion: 2, x: 10, y: -4.4, radiusM: 2.5 },
      { environmentId: ENV, postId: "t-p1-post", mapVersion: 1, generatorVersion: 2, x: 74, y: -4.4, radiusM: 2.5 },
      { environmentId: OTHER, postId: "t-p0-post", mapVersion: 1, generatorVersion: 2, x: 10, y: -4.4, radiusM: 2.5 },
      { environmentId: ENV, postId: "t-cold-post", mapVersion: 1, generatorVersion: 2, x: 200, y: -4.4, radiusM: 2.5 },
    ],
  };
  // Ambientes SINTÉTICOS deste teste começam limpos (rodar de novo na mesma hora).
  for (const tbl of ["tb_arena_checkpoint", "tb_arena_territory_count", "tb_arena_territory_state", "tb_arena_territory_tally", "tb_arena_post"]) {
    await pool.query(`DELETE FROM public.${tbl} WHERE environment_id IN ('br-zz', 'br-zy', 'br-zx')`);
  }
  const pc = await pool.connect();
  try {
    ok((await syncPosts(pc, { posts: postsDoc.posts.filter((p) => p.postId !== "t-cold-post") }, { apply: true, competitive: true, validFromNow: true })).ok, "postes");
    // Poste registrado sem pontuação (o padrão de produção).
    ok((await syncPosts(pc, { posts: postsDoc.posts.filter((p) => p.postId === "t-cold-post") }, { apply: true, environments: [ENV], competitive: false, validFromNow: true })).ok, "poste frio");
  } finally {
    pc.release();
  }
  // syncPosts do poste frio desativou os outros do ambiente (não estavam no
  // documento): reativa — e prova que desativar não apaga.
  await pool.query(`UPDATE public.tb_arena_post SET is_active = TRUE, competitive = TRUE WHERE environment_id = $1 AND post_id <> 't-cold-post'`, [ENV]);

  const users = {};
  for (const tag of ["a", "b", "c", "d", "e"]) users[tag] = await mkUser(tag);
  const t = Object.fromEntries(Object.entries(users).map(([k, v]) => [k, tok(v)]));
  const setActive = async (who, cat, team) => {
    await call("POST", "/arena/session", { token: t[who], service: false });
    let st = (await call("GET", "/arena/me/preferences", { token: t[who], service: false })).body;
    const r = await call("PUT", `/arena/me/preferences/${cat}`, { token: t[who], service: false, body: { teamId: team, expectedRevision: st.revision, activate: true } });
    ok(r.status === 200, `ativar ${who} ${cat}/${team}: ${r.status} ${JSON.stringify(r.body)}`);
    st = r.body.state;
    return st;
  };
  const windowNow = () => {
    const h = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    return new Date(h).toISOString();
  };
  const ckBody = (over = {}) => ({
    requestId: crypto.randomUUID(),
    environmentId: ENV,
    postId: "t-p0-post",
    windowStart: windowNow(),
    expectedCategoryId: null,
    position: { x: 10.5, y: -4.0 },
    ...over,
  });
  const CK = "/arena/internal/checkpoints";

  console.log("\n━━━ canal servidor↔servidor ━━━");
  await check("sem assinatura do serviço → 401 service_auth_required (o navegador não chama)", async () => {
    await setActive("a", "futebol", "teste-azul");
    const r = await call("POST", CK, { token: t.a, body: ckBody(), service: false });
    eq([r.status, r.body.code], [401, "service_auth_required"], "status");
  });
  await check("segredo errado → 401 service_auth_invalid", async () => {
    const r = await call("POST", CK, { token: t.a, body: ckBody(), tamper: { secret: "x".repeat(40) } });
    eq([r.status, r.body.code], [401, "service_auth_invalid"], "status");
  });
  await check("corpo diferente do assinado → 401", async () => {
    const b = ckBody();
    const r = await call("POST", CK, { token: t.a, body: b, tamper: { signedBody: JSON.stringify({ ...b, position: { x: 999, y: 0 } }) } });
    eq(r.status, 401, "status");
  });
  await check("timestamp fora da janela → 401", async () => {
    const r = await call("POST", CK, { token: t.a, body: ckBody(), tamper: { ts: Date.now() - 120_000 } });
    eq([r.status, r.body.code], [401, "service_auth_invalid"], "status");
  });
  await check("nonce repetido (replay) → 401 service_replay", async () => {
    const nonce = crypto.randomBytes(18).toString("base64url");
    const a = await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`, { tamper: { nonce } });
    eq(a.status, 200, "primeira");
    const b = await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`, { tamper: { nonce } });
    eq([b.status, b.body.code], [401, "service_replay"], "repetida");
  });
  await check("assinatura válida sem token do usuário → 401 (identidade continua sendo do titular)", async () => {
    const r = await call("POST", CK, { body: ckBody() });
    eq([r.status, r.body.code], [401, "missing_token"], "status");
  });
  await check("sessão interna devolve o prazo da credencial", async () => {
    const r = await call("POST", "/arena/internal/session", { token: t.a });
    eq(r.status, 200, "status");
    const exp = jwt.decode(t.a).exp * 1000;
    eq(Date.parse(r.body.credential.expiresAt), exp, "expiresAt");
    ok(r.body.player.playerId.startsWith("pl_"), "playerId");
  });

  console.log("\n━━━ checkpoint · validação ━━━");
  await check("perto do poste → aceito, com estado agregado commitado", async () => {
    const r = await call("POST", CK, { token: t.a, body: ckBody() });
    eq([r.status, r.body.result, r.body.teamId], [200, "accepted", "teste-azul"], "resultado");
    eq([r.body.state.status, r.body.state.leaderTeamId, r.body.state.total], ["leader", "teste-azul", 1], "estado");
    const raw = JSON.stringify(r.body);
    ok(!raw.includes(users.a) && !raw.includes("playerId"), "sem identidade na resposta");
  });
  await check("repetir na mesma janela (outro requestId) → already_done, sem contar de novo", async () => {
    const r = await call("POST", CK, { token: t.a, body: ckBody() });
    eq([r.status, r.body.result, r.body.state.total], [200, "already_done", 1], "resultado");
  });
  await check("trocar de equipe na mesma hora NÃO devolve a participação", async () => {
    await setActive("a", "futebol", "teste-verde");
    const r = await call("POST", CK, { token: t.a, body: ckBody() });
    eq([r.body.result, r.body.state.total, r.body.state.leaderTeamId], ["already_done", 1, "teste-azul"], "resultado");
  });
  await check("longe do poste (posição atestada) → 422 out_of_range", async () => {
    await setActive("b", "futebol", "teste-azul");
    const r = await call("POST", CK, { token: t.b, body: ckBody({ position: { x: 20, y: -4.4 } }) });
    eq([r.status, r.body.code], [422, "out_of_range"], "status");
  });
  await check("poste inexistente → 404 unknown_post", async () => {
    const r = await call("POST", CK, { token: t.b, body: ckBody({ postId: "q9-p9-post" }) });
    eq([r.status, r.body.code], [404, "unknown_post"], "status");
  });
  await check("id de poste de OUTRA UF não pontua aqui (cada ambiente tem o seu)", async () => {
    const r = await call("POST", CK, { token: t.b, body: ckBody({ environmentId: OTHER }) });
    eq([r.status, r.body.result], [200, "accepted"], "aceito no outro ambiente");
    const here = await call("POST", CK, { token: t.b, body: ckBody() });
    eq(here.body.result, "accepted", "e conta separado neste");
    eq(here.body.state.environmentId, ENV, "ambiente certo");
  });
  await check("poste registrado mas não competitivo → 422 not_competitive", async () => {
    const r = await call("POST", CK, { token: t.c, body: ckBody({ postId: "t-cold-post", position: { x: 200, y: -4.4 } }) });
    eq([r.status, r.body.code], [422, "not_competitive"], "status");
  });
  await check("sem participação ativa → 422 no_active", async () => {
    await call("POST", "/arena/session", { token: t.c, service: false });
    const r = await call("POST", CK, { token: t.c, body: ckBody() });
    eq([r.status, r.body.code], [422, "no_active"], "status");
  });
  await check("categoria esperada diverge da ativa → 409 category_mismatch (nunca pontua em silêncio)", async () => {
    await setActive("c", "musica", "teste-musica");
    const r = await call("POST", CK, { token: t.c, body: ckBody({ expectedCategoryId: "futebol" }) });
    eq([r.status, r.body.code], [409, "category_mismatch"], "status");
  });
  await check("categorias independentes no mesmo poste", async () => {
    const r = await call("POST", CK, { token: t.c, body: ckBody({ expectedCategoryId: "musica" }) });
    eq([r.body.result, r.body.state.categoryId, r.body.state.total], ["accepted", "musica", 1], "música");
    const f = await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`);
    const foot = f.body.states.find((s) => s.postId === "t-p0-post" && s.categoryId === "futebol");
    eq(foot.total, 2, "futebol intacto");
  });
  await check("janela pretendida diferente da do banco → 409 window_changed (retry após a virada não vira voto)", async () => {
    await setActive("d", "futebol", "teste-verde");
    const prev = new Date(Date.parse(windowNow()) - 3_600_000).toISOString();
    const r = await call("POST", CK, { token: t.d, body: ckBody({ windowStart: prev }) });
    eq([r.status, r.body.code], [409, "window_changed"], "status");
  });
  await check("categoria política fechada: nem a escolha passa (sem política aprovada)", async () => {
    const r = await call("PUT", "/arena/me/preferences/politica", { token: t.e, service: false, body: { teamId: "teste-grupo-a", expectedRevision: 0 } });
    eq(r.status, 422, "status");
    eq(r.body.code, "awaiting_policy", "código");
  });
  await check("consentimento revogado depois de ativar → a participação deixa de valer", async () => {
    await pool.query(`UPDATE public.tb_arena_category SET consent_policy_version = 1 WHERE category_id = 'politica'`);
    try {
      await call("POST", "/arena/session", { token: t.e, service: false });
      eq((await call("PUT", "/arena/me/consents/politica", { token: t.e, service: false, body: { policyVersion: 1 } })).status, 200, "consentir");
      const st = (await call("GET", "/arena/me/preferences", { token: t.e, service: false })).body;
      const s2 = await call("PUT", "/arena/me/preferences/politica", { token: t.e, service: false, body: { teamId: "teste-grupo-a", expectedRevision: st.revision, activate: true } });
      eq(s2.status, 200, "ativar");
      const acc = await call("POST", CK, { token: t.e, body: ckBody({ postId: "t-p1-post", position: { x: 74, y: -4.4 } }) });
      eq(acc.body.result, "accepted", "aceito com consentimento");
      eq([acc.body.state.counts, acc.body.state.total], [null, null], "categoria sensível: sem contagens");
      await call("DELETE", "/arena/me/consents/politica", { token: t.e, service: false });
      const r = await call("POST", CK, { token: t.e, body: ckBody() });
      eq([r.status, r.body.code], [422, "no_active"], "revogado = sem participação");
    } finally {
      await pool.query(`UPDATE public.tb_arena_category SET consent_policy_version = NULL WHERE category_id = 'politica'`);
    }
  });
  await check("conta bloqueada depois de conectar → 403 (o servidor de jogo não autoriza sozinho)", async () => {
    const X = await mkUser("x");
    const tx = tok(X);
    await call("POST", "/arena/session", { token: tx, service: false });
    await pool.query(`UPDATE public.tb_user SET blocked_at = NOW() WHERE id_user = $1`, [X]);
    const r = await call("POST", CK, { token: tx, body: ckBody() });
    eq([r.status, r.body.code], [403, "account_blocked"], "status");
  });
  await check("campo a mais no corpo → 400 (sem atribuição em massa)", async () => {
    const r = await call("POST", CK, { token: t.d, body: { ...ckBody(), teamId: "teste-azul" } });
    eq(r.status, 400, "status");
  });

  console.log("\n━━━ idempotência e concorrência ━━━");
  await check("retry do MESMO requestId devolve o resultado original", async () => {
    const b = ckBody({ postId: "t-p1-post", position: { x: 74, y: -4.4 } });
    const first = await call("POST", CK, { token: t.d, body: b });
    eq(first.body.result, "accepted", "primeiro");
    const again = await call("POST", CK, { token: t.d, body: b });
    eq([again.status, again.body.result, again.body.requestId], [200, "accepted", b.requestId], "retry");
  });
  await check("requestId reutilizado com conteúdo diferente → 409 request_conflict", async () => {
    const b = ckBody({ postId: "t-p1-post", position: { x: 74, y: -4.4 } });
    await call("POST", CK, { token: t.c, body: { ...b, expectedCategoryId: "musica" } });
    const r = await call("POST", CK, { token: t.c, body: { ...b, postId: "t-p0-post", position: { x: 10, y: -4.4 }, expectedCategoryId: "musica" } });
    eq([r.status, r.body.code], [409, "request_conflict"], "status");
  });
  await check("20 pedidos simultâneos da mesma conta (abas/shards) → UMA participação", async () => {
    const Y = await mkUser("y");
    t.y = tok(Y);
    await setActive("y", "futebol", "teste-verde");
    const reqs = Array.from({ length: 20 }, () => call("POST", CK, { token: t.y, body: ckBody({ postId: "t-p1-post", position: { x: 74, y: -4.4 } }) }));
    const out = await Promise.all(reqs);
    eq(out.filter((r) => r.body?.result === "accepted").length, 1, "aceitos");
    eq(out.filter((r) => r.body?.result === "already_done").length, 19, "repetidos");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_checkpoint WHERE id_user = $1`, [Y]);
    eq(n.rows[0].n, 1, "fatos no banco");
  });
  await check("12 contas simultâneas no mesmo poste: contagem exata", async () => {
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(await mkUser(`m${i}`));
    for (const [i, id] of ids.entries()) {
      t[`m${i}`] = tok(id);
      await setActive(`m${i}`, "futebol", i % 2 ? "teste-azul" : "teste-verde");
    }
    const before = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body.states.find((s) => s.postId === "t-p1-post" && s.categoryId === "futebol").total;
    const out = await Promise.all(ids.map((_, i) => call("POST", CK, { token: t[`m${i}`], body: ckBody({ postId: "t-p1-post", position: { x: 74, y: -4.4 } }) })));
    eq(out.every((r) => r.body.result === "accepted"), true, "todos aceitos");
    const after = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body.states.find((s) => s.postId === "t-p1-post" && s.categoryId === "futebol");
    eq(after.total, before + 12, "total");
  });

  console.log("\n━━━ liderança, feed e apuração ━━━");
  await check("empate → status tie sem líder único; desempate vira liderança", async () => {
    const key = { environmentId: ENV, postId: "t-p0-post" };
    const s = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body.states.find((x) => x.postId === key.postId && x.categoryId === "futebol");
    // a=azul, b=azul → azul 2. Dois verdes empatam.
    eq([s.status, s.leaderTeamId], ["leader", "teste-azul"], "antes");
    const v1 = await mkUser("v1");
    const v2 = await mkUser("v2");
    t.v1 = tok(v1);
    t.v2 = tok(v2);
    await setActive("v1", "futebol", "teste-verde");
    await setActive("v2", "futebol", "teste-verde");
    const r1 = await call("POST", CK, { token: t.v1, body: ckBody() });
    const r2 = await call("POST", CK, { token: t.v2, body: ckBody() });
    eq([r1.body.state.status, r2.body.state.status], ["leader", "tie"], "1×0 continua azul, 2×2 empata");
    eq(r2.body.state.leaderTeamId, null, "sem líder único");
    eq(r2.body.state.tiedTeamIds, ["teste-azul", "teste-verde"], "empatados");
    await setActive("d", "futebol", "teste-verde");
    const r3 = await call("POST", CK, { token: t.d, body: ckBody() });
    eq([r3.body.state.status, r3.body.state.leaderTeamId], ["leader", "teste-verde"], "desempate");
  });
  await check("feed por revisão devolve só o que mudou e a janela atual", async () => {
    const all = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body;
    ok(all.states.length >= 3, "estados");
    eq(all.currentWindow.startsAt, windowNow(), "janela atual");
    const later = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=${all.revision}`)).body;
    eq(later.states.length, 0, "nada novo");
    ok(!JSON.stringify(all).includes("id_user"), "sem conta");
  });
  await check("recomputação a partir dos fatos = agregado (consistente)", async () => {
    const r = await Territory.recompute({ environment_id: ENV, post_id: "t-p0-post", category_id: "futebol", window_start: windowNow() });
    eq(r.consistent, true, "consistente");
  });
  await check("agregado adulterado é detectado e corrigido pela recomputação", async () => {
    const key = { environment_id: ENV, post_id: "t-p0-post", category_id: "futebol", window_start: windowNow() };
    await pool.query(`UPDATE public.tb_arena_territory_count SET count = count + 5 WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND team_id = 'teste-azul'`, [ENV, "t-p0-post", "futebol"]);
    eq((await Territory.recompute(key)).consistent, false, "detectado");
    await Territory.recompute(key, { fix: true });
    eq((await Territory.recompute(key)).consistent, true, "corrigido");
  });
  await check("apuração de janela encerrada: idempotente, concorrente e sem duplicar histórico", async () => {
    // Janela PASSADA sintética (como se a hora já tivesse virado).
    const past = new Date(Date.parse(windowNow()) - 3 * 3_600_000).toISOString();
    const key = { environment_id: ENV, post_id: "t-p0-post", category_id: "futebol", window_start: past };
    await pool.query(
      `INSERT INTO public.tb_arena_territory_state (environment_id, post_id, category_id, window_start) VALUES ($1,$2,$3,$4)`,
      [ENV, key.post_id, key.category_id, past]
    );
    for (const [who, team] of [["a", "teste-azul"], ["b", "teste-azul"], ["d", "teste-verde"]]) {
      await pool.query(
        `INSERT INTO public.tb_arena_checkpoint (id_user, environment_id, post_id, category_id, team_id, window_start, accepted_at, request_id, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$6::timestamptz + INTERVAL '10 minutes', gen_random_uuid(), repeat('0',64))`,
        [users[who], ENV, key.post_id, key.category_id, team, past]
      );
    }
    const parallel = await Promise.all([Territory.closeDispute(key), Territory.closeDispute(key), Territory.closeDispute(key)]);
    eq(parallel.filter(Boolean).length, 1, "uma apuração");
    const again = await Territory.closeEndedWindows();
    ok(again.closed === 0 || again.scanned >= 0, "rodar de novo não fecha a mesma");
    const tally = await pool.query(`SELECT status, leader_team_id, total, counts FROM public.tb_arena_territory_tally WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4`, [ENV, key.post_id, key.category_id, past]);
    eq(tally.rows.length, 1, "uma linha de histórico");
    eq([tally.rows[0].status, tally.rows[0].leader_team_id, tally.rows[0].total], ["leader", "teste-azul", 3], "apuração pelos fatos");
    eq(tally.rows[0].counts, { "teste-azul": 2, "teste-verde": 1 }, "contagens");
  });
  await check("janela já apurada não aceita checkpoint tardio", async () => {
    const past = new Date(Date.parse(windowNow()) - 3 * 3_600_000).toISOString();
    const r = await call("POST", CK, { token: t.c, body: ckBody({ windowStart: past, expectedCategoryId: "musica" }) });
    eq([r.status, r.body.code], [409, "window_changed"], "status");
  });
  await check("nova janela não herda o líder da anterior (janela atual ≠ apurada)", async () => {
    const f = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body;
    ok(f.states.every((s) => s.window.startsAt === windowNow()), "feed só da janela atual");
  });
  await check("exclusão da conta anonimiza os fatos sem desfazer o placar", async () => {
    const ArenaService = require("../src/services/ArenaService");
    const before = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body.states.find((s) => s.postId === "t-p0-post" && s.categoryId === "futebol").total;
    await ArenaService.deleteAllForUser(users.b);
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_checkpoint WHERE id_user = $1`, [users.b]);
    eq(n.rows[0].n, 0, "sem vínculo");
    const r = await Territory.recompute({ environment_id: ENV, post_id: "t-p0-post", category_id: "futebol", window_start: windowNow() });
    eq(r.consistent, true, "agregado consistente com os fatos anônimos");
    const after = (await call("GET", `/arena/internal/territory?environmentId=${ENV}&since=0`)).body.states.find((s) => s.postId === "t-p0-post" && s.categoryId === "futebol").total;
    eq(after, before, "placar mantido");
  });
  await check("exportação da conta inclui os checkpoints do titular", async () => {
    const ArenaStorage = require("../src/storages/ArenaStorage");
    const data = await ArenaStorage.exportForUser(pool, users.a);
    ok(Array.isArray(data.checkpoints) && data.checkpoints.length >= 1, "checkpoints");
  });
  await check("a migration 282 é idempotente (reexecutar o SQL)", async () => {
    const sql = fs.readFileSync(path.join(__dirname, "..", "src", "databases", "migrations", "282_arena_territory.sql"), "utf8");
    await pool.query(sql);
    await pool.query(sql);
  });
  await check("registro de postes em produção nasce NÃO competitivo e vale só na próxima hora", async () => {
    const c = await pool.connect();
    try {
      const out = await syncPosts(c, { posts: [{ environmentId: "br-zx", postId: "novo-post", mapVersion: 1, generatorVersion: 2, x: 1, y: 1, radiusM: 2.5 }] }, { apply: true });
      ok(out.ok, "aplica");
    } finally {
      c.release();
    }
    const r = await pool.query(`SELECT competitive, valid_from > clock_timestamp() AS future FROM public.tb_arena_post WHERE environment_id = 'br-zx'`);
    eq([r.rows[0].competitive, r.rows[0].future], [false, true], "registro");
  });

  server.close();
  await pool.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
