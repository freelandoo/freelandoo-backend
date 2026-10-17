// test/arena.e2e.js — Freelandoo Arena, módulos 04 e 05, pela HTTP DE VERDADE.
//
//   npm run test:arena
//
// Sobe o `src/app.js` real numa porta aleatória contra um Postgres de TESTE
// (a suíte RECUSA hosts que pareçam produção), roda as migrations nele e
// exercita: autenticação (token ausente/malformado/assinatura/expirado/claims,
// conta inexistente, bloqueada DEPOIS da emissão, inativa, menor sem vínculo),
// identidade (idempotente e concorrente), catálogo, preferências, seleção
// ativa, concorrência por revisão, categoria sensível e isolamento entre contas.
//
// Com ARENA_CONTRACT_FIXTURES_DIR, grava respostas REAIS (dados sintéticos)
// para a suíte de contrato do repositório freelandoo-arena.

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
// Segredo SÓ deste teste — nunca o da plataforma.
process.env.JWT_SECRET = `arena-e2e-${crypto.randomBytes(16).toString("hex")}`;
process.env.DATABASE_URL_COLD = "";

const FIXTURES = process.env.ARENA_CONTRACT_FIXTURES_DIR || "";
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
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env },
    stdio: "ignore",
  });

  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const { syncCatalog } = require("../src/services/ArenaCatalogSync");
  const catalogDoc = require("../src/databases/seeds/arena-catalog.json");

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, p, { token, body, rawAuth } = {}) => {
    const headers = { Accept: "application/json" };
    if (rawAuth !== undefined) headers.Authorization = rawAuth;
    else if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* corpo vazio */
    }
    return { status: res.status, body: json, headers: res.headers };
  };
  const saveFixture = (name, data) => {
    if (!FIXTURES) return;
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(path.join(FIXTURES, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
  };

  // ─── fixtures (sintéticas) ────────────────────────────────────────────────
  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("senha-de-teste-123", 4);
  async function mkUser(tag, extra = {}) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo, is_minor)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_user`,
      [`Teste ${tag}`, `ar${tag}${stamp}`.slice(0, 30), `arena.${tag}.${stamp}@teste.invalid`, hash, extra.ativo ?? true, extra.is_minor ?? false]
    );
    return r.rows[0].id_user;
  }
  const sign = (id_user, opts = {}) => jwt.sign({ id_user, email: "x@teste.invalid" }, process.env.JWT_SECRET, { expiresIn: "1h", ...opts });

  const A = await mkUser("a");
  const B = await mkUser("b");
  const tA = sign(A);
  const tB = sign(B);

  // Catálogo real + equipes SINTÉTICAS de teste em futebol e política.
  const c0 = await pool.connect();
  try {
    const out = await syncCatalog(c0, catalogDoc, { apply: true });
    ok(out.ok, "catálogo de produção aplica");
  } finally {
    c0.release();
  }
  const synth = async (cat, team, active = true) =>
    pool.query(
      `INSERT INTO public.tb_arena_team (category_id, team_id, labels, is_active, is_synthetic)
       VALUES ($1, $2, '{"pt-BR":"Equipe sintética de teste"}'::jsonb, $3, TRUE)
       ON CONFLICT (category_id, team_id) DO UPDATE SET is_active = EXCLUDED.is_active`,
      [cat, team, active]
    );
  await synth("futebol", "teste-azul");
  await synth("futebol", "teste-verde");
  await synth("futebol", "teste-inativa", false);
  await synth("politica", "teste-grupo-a");
  await synth("politica", "teste-grupo-b");

  console.log("\n━━━ M04 · autenticação ━━━");
  await check("sem token → 401 missing_token", async () => {
    const r = await call("POST", "/arena/session");
    eq([r.status, r.body.code], [401, "missing_token"], "status");
  });
  await check("token malformado → 401 invalid_token", async () => {
    const r = await call("POST", "/arena/session", { rawAuth: "Bearer abc" });
    eq([r.status, r.body.code], [401, "invalid_token"], "status");
  });
  await check("assinatura inválida → 401", async () => {
    const forged = jwt.sign({ id_user: A }, "outro-segredo", { expiresIn: "1h" });
    const r = await call("POST", "/arena/session", { token: forged });
    eq(r.status, 401, "status");
  });
  await check("alg none recusado", async () => {
    const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ id_user: A })).toString("base64url");
    const r = await call("POST", "/arena/session", { rawAuth: `Bearer ${h}.${p}.` });
    eq(r.status, 401, "status");
  });
  await check("token expirado → 401 invalid_token", async () => {
    const r = await call("POST", "/arena/session", { token: sign(A, { expiresIn: -10 }) });
    eq([r.status, r.body.code, r.body.error], [401, "invalid_token", "Sessão expirada"], "resposta");
  });
  await check("claim id_user inválido → 401", async () => {
    const r = await call("POST", "/arena/session", { token: jwt.sign({ id_user: "1 OR 1=1" }, process.env.JWT_SECRET) });
    eq(r.status, 401, "status");
  });
  await check("conta inexistente → 401 account_not_found", async () => {
    const r = await call("POST", "/arena/session", { token: sign(crypto.randomUUID()) });
    eq([r.status, r.body.code], [401, "account_not_found"], "status");
  });
  await check("conta inativa (e-mail não confirmado/apagada) → 403", async () => {
    const id = await mkUser("inativa", { ativo: false });
    const r = await call("POST", "/arena/session", { token: sign(id) });
    eq([r.status, r.body.code], [403, "account_inactive"], "status");
  });
  await check("menor sem vínculo de supervisão ativo → 403", async () => {
    const id = await mkUser("menor", { is_minor: true });
    const r = await call("POST", "/arena/session", { token: sign(id) });
    eq([r.status, r.body.code], [403, "supervision_inactive"], "status");
  });
  await check("resposta pessoal não vai para cache público", async () => {
    const r = await call("POST", "/arena/session", { token: tA });
    ok(/no-store/.test(r.headers.get("cache-control") || ""), "Cache-Control sem no-store");
  });

  console.log("\n━━━ M04 · identidade ━━━");
  let playerA;
  await check("primeira inicialização cria o jogador", async () => {
    const r = await call("POST", "/arena/session", { token: tA });
    eq(r.status, 200, "status");
    playerA = r.body.player.playerId;
    ok(/^pl_[A-Za-z0-9]{10,32}$/.test(playerA), "formato do playerId");
    eq(Object.keys(r.body.player).sort(), ["appearance", "displayName", "playerId"], "DTO público mínimo (M10: aparência no lugar de avatarRef)");
    ok(!JSON.stringify(r.body).includes(A), "id_user não pode sair na resposta");
    ok(!JSON.stringify(r.body).includes("@teste.invalid"), "e-mail não pode sair");
    saveFixture("session", r.body);
  });
  await check("segunda inicialização recupera o MESMO playerId", async () => {
    const r = await call("POST", "/arena/session", { token: sign(A) });
    eq(r.body.player.playerId, playerA, "playerId");
  });
  await check("inicializações concorrentes geram um único jogador", async () => {
    const C = await mkUser("c");
    const t = sign(C);
    const rs = await Promise.all(Array.from({ length: 12 }, () => call("POST", "/arena/session", { token: t })));
    ok(rs.every((r) => r.status === 200), "todas 200");
    eq(new Set(rs.map((r) => r.body.player.playerId)).size, 1, "um playerId");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_player WHERE id_user = $1`, [C]);
    eq(n.rows[0].n, 1, "linhas no banco");
  });
  await check("conta B tem outro playerId", async () => {
    const r = await call("POST", "/arena/session", { token: tB });
    ok(r.body.player.playerId !== playerA, "playerIds iguais");
  });

  console.log("\n━━━ M05 · catálogo ━━━");
  await check("catálogo público lista as 5 categorias com disponibilidade explícita", async () => {
    const r = await call("GET", "/arena/catalog");
    eq(r.status, 200, "status");
    const av = Object.fromEntries(r.body.categories.map((c) => [c.categoryId, c.availability]));
    eq(av, { politica: "awaiting_policy", anime: "no_teams", futebol: "available", musica: "available", series: "no_teams" }, "disponibilidade");
    const fut = r.body.categories.find((c) => c.categoryId === "futebol");
    ok(!fut.teams.some((t) => t.teamId === "teste-inativa"), "equipe inativa não aparece");
    saveFixture("catalog", r.body);
  });

  console.log("\n━━━ M05 · preferências e seleção ativa ━━━");
  const prefs = async (t) => (await call("GET", "/arena/me/preferences", { token: t })).body;
  let rev = (await prefs(tA)).revision;
  await check("criar preferência NÃO ativa participação", async () => {
    const r = await call("PUT", "/arena/me/preferences/futebol", { token: tA, body: { teamId: "teste-azul", expectedRevision: rev } });
    eq(r.status, 200, "status");
    eq(r.body.state.active, null, "ativa");
    eq(r.body.state.preferences.map((p) => [p.categoryId, p.teamId]), [["futebol", "teste-azul"]], "preferências");
    rev = r.body.state.revision;
    saveFixture("preference-saved", r.body);
  });
  await check("equipe de outra categoria é recusada", async () => {
    const r = await call("PUT", "/arena/me/preferences/futebol", { token: tA, body: { teamId: "rock", expectedRevision: rev } });
    eq([r.status, r.body.code], [422, "team_not_in_category"], "status");
  });
  await check("equipe inativa e categoria inexistente são recusadas", async () => {
    const a = await call("PUT", "/arena/me/preferences/futebol", { token: tA, body: { teamId: "teste-inativa", expectedRevision: rev } });
    eq([a.status, a.body.code], [422, "team_unavailable"], "inativa");
    const b = await call("PUT", "/arena/me/preferences/nao-existe", { token: tA, body: { teamId: "rock", expectedRevision: rev } });
    eq([b.status, b.body.code], [404, "unknown_category"], "inexistente");
  });
  await check("campo protegido no corpo é recusado (sem atribuição em massa)", async () => {
    const r = await call("PUT", "/arena/me/preferences/musica", { token: tA, body: { teamId: "rock", expectedRevision: rev, id_user: B } });
    eq([r.status, r.body.code], [400, "invalid_input"], "status");
  });
  await check("salvar e ativar em categorias diferentes coexistem", async () => {
    const r = await call("PUT", "/arena/me/preferences/musica", { token: tA, body: { teamId: "rock", expectedRevision: rev, activate: true } });
    eq(r.status, 200, "status");
    eq(r.body.state.active, { categoryId: "musica", teamId: "rock" }, "ativa");
    eq(r.body.state.preferences.length, 2, "duas preferências");
    rev = r.body.state.revision;
  });
  await check("repetir a operação é idempotente (sem duplicar, revisão igual)", async () => {
    const r = await call("PUT", "/arena/me/preferences/musica", { token: tA, body: { teamId: "rock", expectedRevision: rev - 5 < 0 ? 0 : rev - 1, activate: true } });
    eq([r.status, r.body.changed, r.body.state.revision], [200, false, rev], "no-op");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_preference p JOIN public.tb_arena_player j USING (id_user) WHERE j.id_user = $1`, [A]);
    eq(n.rows[0].n, 2, "linhas");
  });
  await check("requisição obsoleta recebe 409 com o estado atual", async () => {
    const r = await call("PUT", "/arena/me/preferences/futebol", { token: tA, body: { teamId: "teste-verde", expectedRevision: rev - 1 } });
    eq([r.status, r.body.code, r.body.state.revision], [409, "revision_conflict", rev], "conflito");
    saveFixture("conflict", r.body);
  });
  await check("trocar a categoria ativa preserva as outras preferências", async () => {
    const r = await call("PUT", "/arena/me/active", { token: tA, body: { categoryId: "futebol", expectedRevision: rev } });
    eq(r.body.state.active, { categoryId: "futebol", teamId: "teste-azul" }, "ativa");
    eq(r.body.state.preferences.length, 2, "preferências");
    rev = r.body.state.revision;
  });
  await check("trocar a equipe da categoria ativa desativa (não troca em silêncio)", async () => {
    const r = await call("PUT", "/arena/me/preferences/futebol", { token: tA, body: { teamId: "teste-verde", expectedRevision: rev } });
    eq([r.body.activeCleared, r.body.state.active], [true, null], "desativou");
    rev = r.body.state.revision;
  });
  await check("ativar sem preferência é recusado", async () => {
    const r = await call("PUT", "/arena/me/active", { token: tA, body: { categoryId: "anime", expectedRevision: rev } });
    eq([r.status, r.body.code], [422, "preference_required"], "status");
  });
  await check("desativar preserva as preferências", async () => {
    let r = await call("PUT", "/arena/me/active", { token: tA, body: { categoryId: "musica", expectedRevision: rev } });
    rev = r.body.state.revision;
    r = await call("PUT", "/arena/me/active", { token: tA, body: { categoryId: null, expectedRevision: rev } });
    eq([r.body.state.active, r.body.state.preferences.length], [null, 2], "estado");
    rev = r.body.state.revision;
  });
  await check("remover a preferência ativa limpa a seleção na mesma transação", async () => {
    let r = await call("PUT", "/arena/me/active", { token: tA, body: { categoryId: "musica", expectedRevision: rev } });
    rev = r.body.state.revision;
    r = await call("DELETE", "/arena/me/preferences/musica", { token: tA, body: { expectedRevision: rev } });
    eq([r.status, r.body.state.active, r.body.state.preferences.map((p) => p.categoryId)], [200, null, ["futebol"]], "estado");
    const db = await pool.query(`SELECT active_category_id FROM public.tb_arena_player WHERE id_user = $1`, [A]);
    eq(db.rows[0].active_category_id, null, "banco");
    rev = r.body.state.revision;
  });
  await check("remover de novo é idempotente", async () => {
    const r = await call("DELETE", "/arena/me/preferences/musica", { token: tA, body: { expectedRevision: 0 } });
    eq([r.status, r.body.changed], [200, false], "no-op");
  });
  await check("escritas concorrentes: uma vence, as outras recebem 409, invariantes intactos", async () => {
    const rs = await Promise.all(
      ["teste-azul", "teste-verde", "teste-azul", "teste-verde", "teste-azul"].map((team, i) =>
        call("PUT", "/arena/me/preferences/futebol", { token: tA, body: { teamId: team, expectedRevision: rev, activate: i % 2 === 0 } })
      )
    );
    const changed = rs.filter((r) => r.status === 200 && r.body.changed).length;
    ok(changed === 1, `exatamente uma escrita muda o estado (vieram ${changed})`);
    ok(rs.every((r) => r.status === 200 || r.status === 409), "só 200 ou 409");
    const st = await prefs(tA);
    eq(st.revision, rev + 1, "revisão avançou uma vez");
    eq(st.preferences.filter((p) => p.categoryId === "futebol").length, 1, "uma preferência por categoria");
    rev = st.revision;
  });
  await check("equipe desativada no catálogo deixa de valer como participação", async () => {
    let st = await prefs(tA);
    const team = st.preferences.find((p) => p.categoryId === "futebol").teamId;
    const r = await call("PUT", "/arena/me/active", { token: tA, body: { categoryId: "futebol", expectedRevision: st.revision } });
    rev = r.body.state.revision;
    await synth("futebol", team, false);
    st = await prefs(tA);
    eq([st.active, st.activeBlocked], [null, "futebol"], "ativa bloqueada");
    eq(st.preferences.find((p) => p.categoryId === "futebol").valid, false, "preferência inválida");
    await synth("futebol", team, true);
  });

  console.log("\n━━━ M05 · categoria sensível ━━━");
  await check("política sem versão aprovada: coleta desligada", async () => {
    const st = await prefs(tA);
    const r = await call("PUT", "/arena/me/preferences/politica", { token: tA, body: { teamId: "teste-grupo-a", expectedRevision: st.revision } });
    eq([r.status, r.body.code], [422, "awaiting_policy"], "status");
  });
  await pool.query(`UPDATE public.tb_arena_category SET consent_policy_version = 1, updated_at = NOW() WHERE category_id = 'politica'`);
  await check("com política: salvar sem autorização específica é recusado", async () => {
    const st = await prefs(tA);
    const r = await call("PUT", "/arena/me/preferences/politica", { token: tA, body: { teamId: "teste-grupo-a", expectedRevision: st.revision } });
    eq([r.status, r.body.code, r.body.policyVersion], [422, "consent_required", 1], "status");
  });
  await check("autorizar versão diferente da vigente é recusado", async () => {
    const r = await call("PUT", "/arena/me/consents/politica", { token: tA, body: { policyVersion: 2 } });
    eq([r.status, r.body.code], [409, "policy_changed"], "status");
  });
  await check("autorizar + salvar + ativar funciona", async () => {
    let r = await call("PUT", "/arena/me/consents/politica", { token: tA, body: { policyVersion: 1 } });
    eq(r.status, 200, "consentimento");
    r = await call("PUT", "/arena/me/preferences/politica", { token: tA, body: { teamId: "teste-grupo-a", expectedRevision: r.body.state.revision, activate: true } });
    eq(r.body.state.active, { categoryId: "politica", teamId: "teste-grupo-a" }, "ativa");
    saveFixture("preferences-sensitive", r.body.state);
  });
  await check("nova versão da política invalida a escolha até nova autorização", async () => {
    await pool.query(`UPDATE public.tb_arena_category SET consent_policy_version = 2 WHERE category_id = 'politica'`);
    const st = await prefs(tA);
    eq([st.active, st.activeBlocked], [null, "politica"], "bloqueada");
    await pool.query(`UPDATE public.tb_arena_category SET consent_policy_version = 1 WHERE category_id = 'politica'`);
  });
  await check("revogar apaga a escolha e a seleção ativa, guardando só a prova mínima", async () => {
    const r = await call("DELETE", "/arena/me/consents/politica", { token: tA });
    eq(r.status, 200, "status");
    eq([r.body.state.active, r.body.state.preferences.some((p) => p.categoryId === "politica")], [null, false], "estado");
    const ev = await pool.query(`SELECT * FROM public.tb_arena_sensitive_consent WHERE id_user = $1`, [A]);
    ok(ev.rows[0].revoked_at, "revogação registrada");
    eq(Object.keys(ev.rows[0]).sort(), ["category_id", "granted_at", "id_user", "policy_version", "revoked_at"], "prova sem a escolha");
  });
  await check("menor (com vínculo ativo) não escolhe categoria sensível", async () => {
    const resp = await mkUser("resp");
    const m = await mkUser("menor2", { is_minor: true });
    await pool.query(`INSERT INTO public.supervised_accounts (responsible_user_id, minor_user_id, status) VALUES ($1, $2, 'active')`, [resp, m]);
    const t = sign(m);
    const s = await call("POST", "/arena/session", { token: t });
    eq([s.status, s.body.restrictions.sensitiveAllowed], [200, false], "sessão");
    const r = await call("PUT", "/arena/me/consents/politica", { token: t, body: { policyVersion: 1 } });
    eq([r.status, r.body.code], [403, "minor_restricted"], "consentimento");
    const f = await call("PUT", "/arena/me/preferences/musica", { token: t, body: { teamId: "rock", expectedRevision: 0 } });
    eq(f.status, 200, "categoria comum liberada");
  });
  await check("catálogo público não expõe escolha de ninguém", async () => {
    const r = await call("GET", "/arena/catalog");
    ok(!/teste-grupo-a"?,\s*"?(count|players)/.test(JSON.stringify(r.body)), "contagem exposta");
    ok(!JSON.stringify(r.body).includes(playerA), "playerId no catálogo");
  });

  console.log("\n━━━ isolamento e bloqueio ━━━");
  await check("conta B não vê as escolhas de A", async () => {
    const st = await prefs(tB);
    eq(st.preferences, [], "preferências de B");
  });
  await check("bloquear a conta DEPOIS de emitir o token recusa novas operações", async () => {
    await pool.query(`UPDATE public.tb_user SET blocked_at = NOW() WHERE id_user = $1`, [B]);
    const r = await call("GET", "/arena/me/preferences", { token: tB });
    eq([r.status, r.body.code], [403, "account_blocked"], "status");
    const w = await call("PUT", "/arena/me/active", { token: tB, body: { categoryId: null, expectedRevision: 0 } });
    eq(w.status, 403, "escrita");
  });
  await check("apagar a conta leva o jogador e as escolhas junto", async () => {
    const DeleteMe = require("../src/services/user/DeleteMeService");
    await DeleteMe.execute({ db: pool, id_user: A });
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_player WHERE id_user = $1`, [A]);
    eq(n.rows[0].n, 0, "jogador");
    const r = await call("GET", "/arena/me/preferences", { token: tA });
    eq([r.status, r.body.code], [403, "account_inactive"], "token antigo recusado");
  });
  await check("exportação da conta inclui os dados da Arena", async () => {
    const C = await mkUser("exp");
    await call("POST", "/arena/session", { token: sign(C) });
    const ExportMe = require("../src/services/user/ExportMeService");
    const data = await ExportMe.execute({ db: pool, id_user: C });
    ok(data.arena && data.arena.player.player_id, "arena no export");
  });
  await check("a migration 281 é idempotente (reexecutar o SQL)", async () => {
    const sql = fs.readFileSync(path.join(__dirname, "..", "src", "databases", "migrations", "281_arena_players_preferences.sql"), "utf8");
    await pool.query(sql);
    await pool.query(sql);
  });
  await check("corpo grande é recusado", async () => {
    const r = await call("PUT", "/arena/me/active", { token: tB, body: { categoryId: null, expectedRevision: 0, pad: "x".repeat(5000) } });
    eq(r.status, 413, "status");
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
