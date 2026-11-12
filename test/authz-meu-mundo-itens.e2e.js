// test/authz-meu-mundo-itens.e2e.js — Segurança da trilha E, fatia E21 (itens do Meu Mundo, fase 4).
//
//   npm run test:authz:mm-itens   (ou `npm run test:authz`, que roda os lotes)
//
// Pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432):
//   0. anônimo → 401 em toda rota nova (runas, Ascensão, Despertar, encanto, troca, baú, coleção,
//      preparo, eventos);
//   1. conta comum → 403 (o Meu Mundo ainda é só de administrador);
//   2. instância de outra conta: B não engasta, não tira runa, não ascende, não desperta, não encanta
//      nem resolve encanto na cópia da A (404), e a cópia da A não muda;
//   3. ticket de outra conta: B não gasta preparo na luta da A;
//   4. corrida de duas abas com CHAVES diferentes: duas trocas que cabem uma só no saldo → uma passa;
//   5. replay de chave: a mesma chave com outro pedido devolve o recibo do primeiro e não executa nada;
//   6. o livro de itens bate com o saldo (scripts/mm-item-audit.js) depois de tudo;
//   7. as rotas novas passam pelo limitador `mmItems`.
const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || "segredo-de-teste";
process.env.FRONTEND_URL = "https://freelandoo.test";
process.env.R2_PUBLIC_URL = "https://r2.test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const jwt = require("jsonwebtoken");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`  ✓ ${label}`);
  } else {
    FAIL++;
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
  }
}
const uid = () => crypto.randomBytes(4).toString("hex");
const key = () => crypto.randomUUID();

execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

const pool = require("../src/databases");
const app = require("../src/app");
const Life = require("../src/services/MeuMundoLifeService");
const { audit } = require("../scripts/mm-item-audit");

let base;
async function call(method, p, { token, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/meu-mundo/admin${p}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _text: text }; }
  return { status: res.status, body: json };
}

async function createUser(nome, admin) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email`,
    [nome, `authzmm${uid()}`, `authzmm${uid()}@t.test`]
  );
  const u = r.rows[0];
  if (admin) {
    await pool.query(`INSERT INTO tb_role (desc_role, is_active) SELECT 'Administrator', TRUE WHERE NOT EXISTS (SELECT 1 FROM tb_role WHERE desc_role = 'Administrator')`);
    await pool.query(`INSERT INTO tb_user_role (id_user, id_role, is_active) SELECT $1, id_role, TRUE FROM tb_role WHERE desc_role = 'Administrator' LIMIT 1`, [u.id_user]);
    await Life.peek(u.id_user);
    await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm') ON CONFLICT DO NOTHING`, [u.id_user]);
  }
  return u;
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

const ROUTES = [
  ["POST", "/gear/socket"], ["POST", "/gear/unsocket"], ["POST", "/gear/rune/fuse"],
  ["POST", "/gear/ascend"], ["POST", "/gear/awaken"], ["POST", "/gear/enchant"], ["POST", "/gear/enchant/resolve"],
  ["POST", "/gear/exchange"], ["GET", "/gear/collection"], ["POST", "/gear/chest/open"],
  ["POST", "/fight/prep"], ["GET", "/evento/config"], ["POST", "/evento/config"],
];

(async () => {
  const A = await createUser("Authz MM A", true);
  const Bu = await createUser("Authz MM B", true);
  const C = await createUser("Authz MM comum", false);
  const users = [A.id_user, Bu.id_user, C.id_user];
  const tA = tokenOf(A), tB = tokenOf(Bu), tC = tokenOf(C);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    console.log("0. anônimo");
    for (const [m, p] of ROUTES) {
      const r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p} sem login = 401`, r.status === 401, `veio ${r.status}`);
    }
    console.log("1. conta comum");
    for (const [m, p] of ROUTES) {
      const r = await call(m, p, { token: tC, body: m === "GET" ? undefined : {} });
      check(`${m} ${p} com conta comum = 403`, r.status === 403, `veio ${r.status}`);
    }

    console.log("2. instância de outra conta");
    // a A ganha fichas pela porta normal (troca do Paint precisa de saldo: semeado pelo livro)
    const GearStore = require("../src/storages/MeuMundoGearStorage");
    await Life.withLife(A.id_user, async (s, ctx) => {
      await GearStore.addStack(ctx.client, A.id_user, "ficha_paint", 40);
      await GearStore.addStack(ctx.client, A.id_user, "runa_ataque_1", 3);
      await GearStore.addStack(ctx.client, A.id_user, "selo_dominio", 20);
      await GearStore.addStack(ctx.client, Bu.id_user, "runa_ataque_1", 3);
      await GearStore.addStack(ctx.client, Bu.id_user, "selo_dominio", 20);
      await GearStore.addStack(ctx.client, Bu.id_user, "po_refino", 100);
      await GearStore.addStack(ctx.client, Bu.id_user, "cristal_bruto", 10);
      return {};
    });
    const inst = (await pool.query(`INSERT INTO tb_mm_gear_instance (id_user, item_id, plus, rules) VALUES ($1, 'espada_carmesim', 10, 'forge-v2') RETURNING id_instance, version`, [A.id_user])).rows[0];
    const before = JSON.stringify((await pool.query(`SELECT plus, ascended, awakened, sockets, affixes FROM tb_mm_gear_instance WHERE id_instance = $1`, [inst.id_instance])).rows[0]);
    const cross = [
      ["/gear/socket", { instance: inst.id_instance, rune: "runa_ataque_1" }],
      ["/gear/unsocket", { instance: inst.id_instance, index: 0 }],
      ["/gear/ascend", { instance: inst.id_instance }],
      ["/gear/awaken", { instance: inst.id_instance }],
      ["/gear/enchant", { instance: inst.id_instance }],
      ["/gear/enchant/resolve", { instance: inst.id_instance, choice: null }],
    ];
    for (const [p, body] of cross) {
      const r = await call("POST", p, { token: tB, body: { ...body, key: key() } });
      check(`B em ${p} na cópia da A = 404`, r.status === 404 && r.body && r.body.code === "instance", `veio ${r.status} ${r.body && r.body.code}`);
    }
    const after = JSON.stringify((await pool.query(`SELECT plus, ascended, awakened, sockets, affixes FROM tb_mm_gear_instance WHERE id_instance = $1`, [inst.id_instance])).rows[0]);
    check("a cópia da A não mudou", before === after);
    const mine = await call("POST", "/gear/socket", { token: tA, body: { instance: inst.id_instance, rune: "runa_ataque_1", key: key() } });
    check("a A engasta na própria cópia", mine.status === 200, `veio ${mine.status} ${mine.body && mine.body.error}`);

    console.log("3. ticket de outra conta");
    const Adv = require("../src/services/MeuMundoAdventureService");
    const open = await Adv.fightStart(A.id_user, { origin: "laminas", kind: "brute", level: 1 });
    const prepB = await call("POST", "/fight/prep", { token: tB, body: { ticket: open.fight.ticket, item: "tonico_vida" } });
    check("B não gasta preparo na luta da A (404)", prepB.status === 404, `veio ${prepB.status}`);

    console.log("4. corrida de duas abas (chaves diferentes)");
    const [x, y] = await Promise.all([
      call("POST", "/gear/exchange", { token: tA, body: { offer: "paint:frag_moldes", key: key() } }),
      call("POST", "/gear/exchange", { token: tA, body: { offer: "paint:frag_moldes", key: key() } }),
    ]);
    const ok = [x, y].filter((r) => r.status === 200).length;
    const fichas = Number((await pool.query(`SELECT qty FROM tb_mm_gear WHERE id_user = $1 AND item_id = 'ficha_paint'`, [A.id_user])).rows[0].qty);
    check("duas trocas que cabem uma no saldo: só uma passa", ok === 1 && fichas === 10, `ok=${ok} fichas=${fichas}`);

    console.log("5. replay de chave com outro pedido");
    const k = key();
    const first = await call("POST", "/gear/exchange", { token: tA, body: { offer: "paint:po_forja", key: k } });
    const replay = await call("POST", "/gear/exchange", { token: tA, body: { offer: "paint:minerio", key: k } });
    const minerio = (await pool.query(`SELECT qty FROM tb_mm_gear WHERE id_user = $1 AND item_id = 'minerio_ferro'`, [A.id_user])).rows[0];
    check("a mesma chave devolve o recibo do primeiro e não executa o segundo", first.status === 200 && replay.status === 200 && replay.body.replay === true
      && replay.body.receipt.eventId === first.body.receipt.eventId && !minerio, `replay=${replay.body && replay.body.replay}`);

    console.log("6. livro × saldo");
    for (const u of [A, Bu]) {
      const out = await audit(pool, { idUser: u.id_user });
      check(`livro de itens bate com a pilha (${u === A ? "A" : "B"})`, out.bad.length === 0 && out.checked > 0, JSON.stringify(out.bad));
    }

    console.log("7. limitador nas rotas novas");
    const router = require("../src/routes/meuMundoAdmin.routes");
    const RL = require("../src/middlewares/rateLimit").mmItems;
    const limited = (p) => router.stack.some((l) => l.route && l.route.path === p && l.route.stack.some((s) => s.handle === RL));
    for (const [m, p] of ROUTES.filter(([mm]) => mm === "POST")) check(`${p} passa pelo limitador`, limited(p));
  } finally {
    server.close();
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.end();
  }
  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
