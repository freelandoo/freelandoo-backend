// test/arena-avatars.e2e.js — Freelandoo Arena, Módulo 10 (avatares), pela HTTP DE VERDADE.
//
//   npm run test:arena-avatars
//
// Sobe o `src/app.js` real contra um Postgres de TESTE (recusa produção), roda
// as migrations e exercita: sincronização do catálogo (documento inválido
// recusado, simulação sem gravar), catálogo público sem dado pessoal,
// concessão padrão idempotente (sequencial e concorrente), aparência pública
// na sessão, equipar (persistência, revisão, no-op idempotente, combinação
// sem suporte, derivado não pronto, sem posse, modelo indisponível, ids
// tortos), concorrência entre abas, concessão/revogação de admin e o
// fallback explícito quando o equipado deixa de valer.

const path = require("node:path");
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
process.env.JWT_SECRET = `arena-avatars-${crypto.randomBytes(16).toString("hex")}`;
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

const DOC = (stamp, extra = {}) => ({
  version: 1,
  models: [
    {
      modelId: `noble-${stamp}`,
      labels: { "pt-BR": "Nobre", en: "Noble", es: "Noble" },
      order: 1,
      status: "ready",
      defaultGrant: true,
      saleStatus: "rights_unconfirmed",
      assetVersion: "t1",
      variants: [
        { skinId: "original", hairId: "original", ready: true },
        { skinId: "tone-1", hairId: "black", ready: true },
        { skinId: "tone-3", hairId: "black", ready: false },
      ],
    },
    {
      modelId: `premium-${stamp}`,
      labels: { "pt-BR": "Premium" },
      order: 2,
      status: "ready",
      defaultGrant: false,
      saleStatus: "owner_decision",
      variants: [
        { skinId: "original", hairId: "original", ready: true },
        { skinId: "tone-1", hairId: "black", ready: true },
      ],
    },
    {
      modelId: `draft-${stamp}`,
      labels: {},
      order: 3,
      status: "draft",
      defaultGrant: true,
      saleStatus: "not_for_sale",
      variants: [{ skinId: "original", hairId: "original", ready: false }],
    },
    ...(extra.more || []),
  ],
});

async function main() {
  console.log("━━━ migrations (banco de teste) ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const { syncAvatars } = require("../src/services/ArenaAvatarSync");
  const ArenaAvatarStorage = require("../src/storages/ArenaAvatarStorage");

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { token, body } = {}) => {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* vazio */
    }
    return { status: res.status, body: json };
  };

  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("senha-de-teste-123", 4);
  async function mkUser(tag) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo, is_minor)
       VALUES ($1, $2, $3, $4, TRUE, FALSE) RETURNING id_user`,
      [`Avatar ${tag}`, `av${tag}${stamp}`.slice(0, 30), `arena.avatar.${tag}.${stamp}@teste.invalid`, hash]
    );
    return r.rows[0].id_user;
  }
  const tok = (id) => jwt.sign({ id_user: id, email: "x@teste.invalid" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const A = await mkUser("a");
  const B = await mkUser("b");
  const t = { a: tok(A), b: tok(B) };
  const noble = `noble-${stamp}`;
  const premium = `premium-${stamp}`;
  const draft = `draft-${stamp}`;

  console.log("━━━ estrutura ━━━");
  await check("migration 285 aplicada: tabelas, colunas e constraints", async () => {
    const r = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conname IN
        ('chk_arena_avatar_model_status','chk_arena_avatar_model_sale','chk_arena_avatar_grant_source',
         'chk_arena_player_avatar_all_or_none','chk_arena_player_avatar_revision') ORDER BY conname`
    );
    eq(r.rows.length, 5, "constraints");
    const c = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'tb_arena_player' AND column_name LIKE 'avatar_%' ORDER BY 1`
    );
    eq(c.rows.map((x) => x.column_name), ["avatar_hair_id", "avatar_model_id", "avatar_revision", "avatar_skin_id", "avatar_updated_at"], "colunas");
  });
  await check("migration 285 é idempotente (segunda execução)", async () => {
    const fs = require("node:fs");
    await pool.query(fs.readFileSync(path.join(__dirname, "..", "src", "databases", "migrations", "285_arena_avatars.sql"), "utf8"));
  });
  await check("banco recusa sale_status 'for_sale' e meia aparência", async () => {
    let err = null;
    try {
      await pool.query(`INSERT INTO public.tb_arena_avatar_model (model_id, sale_status) VALUES ('x-${stamp}', 'for_sale')`);
    } catch (e) {
      err = e;
    }
    ok(err && err.constraint === "chk_arena_avatar_model_sale", `esperado chk_arena_avatar_model_sale, veio ${err && err.constraint}`);
    let half = null;
    try {
      await pool.query(`UPDATE public.tb_arena_player SET avatar_skin_id = 'tone-1' WHERE id_user = $1`, [A]);
      await pool.query(
        `INSERT INTO public.tb_arena_player (id_user, player_id, avatar_skin_id) VALUES ($1, $2, 'tone-1')`,
        [A, `pl_half${stamp}`.padEnd(13, "x")]
      );
    } catch (e) {
      half = e;
    }
    ok(half && half.constraint === "chk_arena_player_avatar_all_or_none", `esperado all_or_none, veio ${half && half.constraint}`);
  });

  console.log("━━━ sincronização ━━━");
  const client = await pool.connect();
  await check("documento inválido é recusado inteiro", async () => {
    const bad = DOC(stamp);
    bad.models[0].variants = [{ skinId: "tone-1", hairId: "black", ready: true }];
    const out = await syncAvatars(client, bad, { apply: true });
    ok(!out.ok && out.errors.some((e) => /original/.test(e)), `esperava recusa por falta da original: ${JSON.stringify(out)}`);
    const out2 = await syncAvatars(client, { version: 1, models: [{ modelId: "../x", status: "ready", saleStatus: "x", variants: [] }] });
    ok(!out2.ok, "id torto aceito");
  });
  await check("simulação não grava nada", async () => {
    const out = await syncAvatars(client, DOC(stamp), { apply: false });
    ok(out.ok, JSON.stringify(out));
    ok(!(await ArenaAvatarStorage.getModel(pool, noble)), "simulação gravou");
  });
  await check("aplicar grava modelos e variantes", async () => {
    const out = await syncAvatars(client, DOC(stamp), { apply: true });
    ok(out.ok, JSON.stringify(out));
    eq((await ArenaAvatarStorage.getModel(pool, noble)).status, "ready", "status");
    eq((await ArenaAvatarStorage.getVariant(pool, noble, "tone-3", "black")).ready, false, "não pronta");
  });
  client.release();

  console.log("━━━ catálogo público ━━━");
  await check("catálogo lista só prontos, só variantes prontas, sem dado pessoal", async () => {
    const r = await call("GET", "/arena/avatars/catalog");
    eq(r.status, 200, "status");
    const ids = r.body.models.map((m) => m.modelId);
    ok(ids.includes(noble) && ids.includes(premium), "faltou modelo pronto");
    ok(!ids.includes(draft), "rascunho apareceu");
    const n = r.body.models.find((m) => m.modelId === noble);
    eq(n.variants, [["original", "original"], ["tone-1", "black"]], "variantes prontas");
    eq(n.acquisition, { available: false, reason: "granted_by_default" }, "aquisição do padrão");
    eq(r.body.models.find((m) => m.modelId === premium).acquisition, { available: false, reason: "owner_decision" }, "aquisição sem compra");
    const s = JSON.stringify(r.body);
    ok(!s.includes(A) && !/owned|id_user|source/.test(s), "catálogo vazou dado pessoal");
  });

  console.log("━━━ concessão padrão e sessão ━━━");
  await check("sem token: 401 no GET e no PUT", async () => {
    eq((await call("GET", "/arena/me/avatar")).status, 401, "GET");
    eq((await call("PUT", "/arena/me/avatar", { body: {} })).status, 401, "PUT");
  });
  await check("sessão devolve aparência pública (padrão, original) e só três campos", async () => {
    const r = await call("POST", "/arena/session", { token: t.a });
    eq(r.status, 200, "status");
    eq(Object.keys(r.body.player).sort(), ["appearance", "displayName", "playerId"], "DTO");
    const ap = r.body.player.appearance;
    ok(ap && ap.skinId === "original" && ap.hairId === "original" && ap.rev === 0, JSON.stringify(ap));
    // O modelo padrão de MENOR ordem entre os prontos (pode haver outros
    // padrões de suítes anteriores no banco de teste): basta ser padrão.
    const m = await ArenaAvatarStorage.getModel(pool, ap.modelId);
    ok(m && m.default_grant && m.status === "ready", "aparência pública não é um modelo padrão pronto");
  });
  await check("concessão padrão idempotente, inclusive concorrente", async () => {
    await Promise.all([1, 2, 3, 4, 5].map(() => call("GET", "/arena/me/avatar", { token: t.b })));
    await call("GET", "/arena/me/avatar", { token: t.b });
    const r = await pool.query(`SELECT count(*)::int n FROM public.tb_arena_avatar_grant WHERE id_user = $1 AND model_id = $2`, [B, noble]);
    eq(r.rows[0].n, 1, "posses");
    const src = await pool.query(`SELECT source FROM public.tb_arena_avatar_grant WHERE id_user = $1 AND model_id = $2`, [B, noble]);
    eq(src.rows[0].source, "default", "origem");
  });
  await check("rascunho e modelo não-padrão não são concedidos", async () => {
    const r = await call("GET", "/arena/me/avatar", { token: t.a });
    const owned = r.body.owned.map((o) => o.modelId);
    ok(owned.includes(noble) && !owned.includes(premium) && !owned.includes(draft), JSON.stringify(owned));
  });

  console.log("━━━ equipar ━━━");
  const put = (token, body) => call("PUT", "/arena/me/avatar", { token, body });
  await check("ids tortos e revisão ausente: 400", async () => {
    eq((await put(t.a, { modelId: "../../x", skinId: "original", hairId: "original", expectedRevision: 0 })).status, 400, "modelo");
    eq((await put(t.a, { modelId: noble, skinId: "https://x", hairId: "original", expectedRevision: 0 })).status, 400, "pele");
    eq((await put(t.a, { modelId: noble, skinId: "original", hairId: "original" })).status, 400, "revisão");
  });
  await check("equipar combinação pronta persiste e sobe a revisão", async () => {
    const r = await put(t.a, { modelId: noble, skinId: "tone-1", hairId: "black", expectedRevision: 0 });
    eq(r.status, 200, `status ${JSON.stringify(r.body)}`);
    eq(r.body.revision, 1, "revisão");
    eq(r.body.equipped, { modelId: noble, skinId: "tone-1", hairId: "black" }, "equipado");
    const again = await call("GET", "/arena/me/avatar", { token: t.a });
    eq(again.body.equipped, { modelId: noble, skinId: "tone-1", hairId: "black" }, "depois de recarregar");
    const s = await call("POST", "/arena/session", { token: t.a });
    eq(s.body.player.appearance, { modelId: noble, skinId: "tone-1", hairId: "black", rev: 1 }, "na sessão nova");
  });
  await check("repetir o que já está equipado é no-op 200, mesmo com revisão velha", async () => {
    const r = await put(t.a, { modelId: noble, skinId: "tone-1", hairId: "black", expectedRevision: 0 });
    eq(r.status, 200, "status");
    eq(r.body.revision, 1, "revisão não subiu");
  });
  await check("revisão velha com mudança: 409 com o estado atual", async () => {
    const r = await put(t.a, { modelId: noble, skinId: "original", hairId: "original", expectedRevision: 0 });
    eq(r.status, 409, "status");
    eq(r.body.code, "revision_conflict", "código");
    eq(r.body.state.revision, 1, "estado atual");
  });
  await check("combinação sem suporte: 422", async () => {
    const r = await put(t.a, { modelId: noble, skinId: "tone-5", hairId: "blonde", expectedRevision: 1 });
    eq([r.status, r.body.code], [422, "combination_unsupported"], "recusa");
  });
  await check("derivado não pronto: 409 variant_not_ready", async () => {
    const r = await put(t.a, { modelId: noble, skinId: "tone-3", hairId: "black", expectedRevision: 1 });
    eq([r.status, r.body.code], [409, "variant_not_ready"], "recusa");
  });
  await check("modelo sem posse: 403 (preview ≠ equipar)", async () => {
    const r = await put(t.a, { modelId: premium, skinId: "original", hairId: "original", expectedRevision: 1 });
    eq([r.status, r.body.code], [403, "not_owned"], "recusa");
  });
  await check("modelo em rascunho ou inexistente: 409 model_unavailable", async () => {
    eq((await put(t.a, { modelId: draft, skinId: "original", hairId: "original", expectedRevision: 1 })).body.code, "model_unavailable", "rascunho");
    eq((await put(t.a, { modelId: `nao-existe-${stamp}`, skinId: "original", hairId: "original", expectedRevision: 1 })).body.code, "model_unavailable", "inexistente");
  });
  await check("recusas não mexem no equipado nem na revisão", async () => {
    const r = await call("GET", "/arena/me/avatar", { token: t.a });
    eq([r.body.revision, r.body.equipped.skinId], [1, "tone-1"], "intacto");
  });
  await check("duas abas com a mesma revisão: uma vence, a outra recebe 409", async () => {
    const [x, y] = await Promise.all([
      put(t.b, { modelId: noble, skinId: "tone-1", hairId: "black", expectedRevision: 0 }),
      put(t.b, { modelId: noble, skinId: "original", hairId: "original", expectedRevision: 0 }),
    ]);
    const codes = [x.status, y.status].sort();
    eq(codes, [200, 409], `resultado ${JSON.stringify([x.body, y.body])}`);
    const r = await call("GET", "/arena/me/avatar", { token: t.b });
    eq(r.body.revision, 1, "uma única escrita");
  });

  console.log("━━━ posse de admin, revogação e fallback ━━━");
  await check("concessão de admin com referência única é idempotente", async () => {
    const g1 = await ArenaAvatarStorage.grantAdmin(pool, A, premium, `admin:teste-${stamp}`);
    const g2 = await ArenaAvatarStorage.grantAdmin(pool, A, premium, `admin:teste-${stamp}`);
    ok(g1 && !g2, "concedeu duas vezes");
    const r = await put(t.a, { modelId: premium, skinId: "original", hairId: "original", expectedRevision: 1 });
    eq(r.status, 200, `equipar após conceder: ${JSON.stringify(r.body)}`);
  });
  await check("revogar a posse: aparência pública cai no padrão original, o equipado fica guardado", async () => {
    await ArenaAvatarStorage.revoke(pool, A, premium);
    const r = await call("GET", "/arena/me/avatar", { token: t.a });
    eq(r.body.equipped.modelId, premium, "guardado");
    eq([r.body.appearance.skinId, r.body.appearance.hairId], ["original", "original"], "fallback");
    ok(r.body.appearance.modelId !== premium, "ainda mostra o modelo revogado");
  });
  await check("modelo aposentado pela sincronização também cai no fallback", async () => {
    await put(t.b, { modelId: noble, skinId: "tone-1", hairId: "black", expectedRevision: 1 }).then(() => null);
    const c2 = await pool.connect();
    const doc = DOC(stamp);
    doc.models = doc.models.filter((m) => m.modelId !== noble);
    doc.models.push({ ...DOC(`alt${stamp}`).models[0] });
    const out = await syncAvatars(c2, doc, { apply: true });
    c2.release();
    ok(out.ok && out.summary.retired.includes(noble), JSON.stringify(out));
    const s = await call("POST", "/arena/session", { token: t.b });
    ok(s.body.player.appearance && s.body.player.appearance.modelId !== noble, JSON.stringify(s.body.player.appearance));
  });

  server.close();
  await pool.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ok`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
