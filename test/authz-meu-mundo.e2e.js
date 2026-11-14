// test/authz-meu-mundo.e2e.js — Segurança A1, lote 8 (Meu Mundo).
//
//   npm run test:authz:meu-mundo   (ou `npm run test:authz`, que roda os lotes)
//
// O jogo ainda é só de Administrator (o lote 7 prova a porta). Este lote pergunta o que vale
// quando ele abrir: entre DOIS jogadores, B consegue mexer no que é da A trocando o id?
//   0. ferramentas do jogo (soltar o deus, estátua, eventos, personagem de teste, nível da casa,
//      status, vídeos) usam a trava PRÓPRIA `ferramenta` — abrir o jogo troca só a do jogador;
//   1. correio: B não abre nem resgata o presente da carta da A (404) e a carta segue intacta;
//   2. compra de Pólen: B não lê o recibo da sessão da A (404); a A lê;
//   3. personagem: B não acorda nem acelera o personagem da A (404);
//   4. luta: B não fecha a luta da A pelo ticket;
//   5. chat: denúncia de mensagem que não é do Global do jogo → 404.
// Itens (instâncias, runas, preparo) ficam no test/authz-meu-mundo-itens.e2e.js (E21).
// Visitas: conferidas no código (MeuMundoService.accept/decline/cancel/endVisit pedem convidado,
// anfitrião ou um dos dois no próprio convite) — montar casa e bairro só para isso é teste de jogo.
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
const fs = require("fs");
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

execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

const pool = require("../src/databases");
const app = require("../src/app");

let base;
async function call(method, p, { token, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${p}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _text: text };
  }
  return { status: res.status, body: json };
}

async function createPlayer(nome) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email`,
    [nome, `authzmm${uid()}`, `authzmm${uid()}@t.test`]
  );
  const u = r.rows[0];
  await pool.query(`INSERT INTO tb_role (desc_role, is_active) SELECT 'Administrator', TRUE WHERE NOT EXISTS (SELECT 1 FROM tb_role WHERE desc_role = 'Administrator')`);
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role, is_active) SELECT $1, id_role, TRUE FROM tb_role WHERE desc_role = 'Administrator' LIMIT 1`, [u.id_user]);
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm') ON CONFLICT DO NOTHING`, [u.id_user]);
  return u;
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
const FAKE = "00000000-0000-4000-8000-0000000000aa";

(async () => {
  const users = [];
  let server;
  try {
    // ── 0. ferramentas com trava própria (leitura da tabela de rotas) ───────────
    console.log("\n▶ 0. ferramentas do jogo com trava própria");
    const src = fs.readFileSync(path.join(__dirname, "../src/routes/meuMundoAdmin.routes.js"), "utf8");
    const TOOLS = [
      ["post", "/clan/artifact"],
      ["post", "/house/level"],
      ["get", "/estatua/config"],
      ["post", "/estatua/config"],
      ["post", "/deus/soltar"],
      ["get", "/evento/config"],
      ["post", "/evento/config"],
      ["post", "/characters/test-grant"],
      ["get", "/status"],
    ];
    for (const [m, p] of TOOLS) {
      const line = src.split("\n").find((l) => l.startsWith(`router.${m}("${p}",`)) || "";
      check(`${m.toUpperCase()} ${p} usa a trava das ferramentas`, /\.\.\.ferramenta\b/.test(line), line.slice(0, 120));
    }
    check("vídeos usam a trava das ferramentas", /const videoAdmin = ferramenta\b/.test(src));
    check("a trava das ferramentas é só do Administrator", /const ferramenta = \[authMiddleware, Object\.defineProperty\(roleMiddleware\("Administrator"\)/.test(src));

    const A = await createPlayer("Ana Jogadora");
    const B = await createPlayer("Beto Intruso");
    users.push(A, B);
    const [tA, tB] = [A, B].map(tokenOf);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    // ── 1. correio ──────────────────────────────────────────────────────────────
    console.log("\n▶ 1. correio da A");
    const mail = (
      await pool.query(
        `INSERT INTO tb_mm_mail (id_user, kind, title, body, gift) VALUES ($1, 'gift', 'Presente', 'oi', '{"type":"coins","qty":50}'::jsonb) RETURNING id`,
        [A.id_user]
      )
    ).rows[0];
    let r = await call("GET", `/meu-mundo/admin/mail/${mail.id}`, { token: tB });
    check("B não abre a carta da A (404)", r.status === 404, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    r = await call("POST", `/meu-mundo/admin/mail/${mail.id}/claim`, { token: tB });
    check("B não resgata o presente da A", r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    const m2 = (await pool.query(`SELECT read_at, claimed_at FROM tb_mm_mail WHERE id = $1`, [mail.id])).rows[0];
    check("a carta da A segue fechada e sem resgate", m2 && !m2.read_at && !m2.claimed_at, JSON.stringify(m2));
    r = await call("GET", `/meu-mundo/admin/mail/${mail.id}`, { token: tA });
    check("a A abre a própria carta", r.status === 200, String(r.status));

    // ── 2. compra de Pólen ──────────────────────────────────────────────────────
    console.log("\n▶ 2. recibo de compra de Pólen");
    // produto temporário (banco vazio não tem nenhum)
    const prod = (
      await pool.query(`INSERT INTO polen_products (name, price_cents, polens_amount, is_active) VALUES ('authz pacote', 990, 100, FALSE) RETURNING id`)
    ).rows[0];
    if (prod) {
      const session = `sess_authz_${uid()}`;
      await pool.query(
        `INSERT INTO polen_purchases (user_id, product_id, status, amount_cents, polens_credited, stripe_session_id) VALUES ($1, $2, 'paid', 990, 100, $3)`,
        [A.id_user, prod.id, session]
      );
      r = await call("GET", `/meu-mundo/admin/polens/purchase/${session}`, { token: tB });
      check("B não lê o recibo da A (404)", r.status === 404, String(r.status));
      r = await call("GET", `/meu-mundo/admin/polens/purchase/${session}`, { token: tA });
      check("a A lê o próprio recibo", r.status === 200 && r.body?.purchase?.polens === 100, `${r.status} ${JSON.stringify(r.body)}`);
      await pool.query(`DELETE FROM polen_purchases WHERE stripe_session_id = $1`, [session]);
      await pool.query(`DELETE FROM polen_products WHERE id = $1`, [prod.id]);
    } else {
      check("há produto de Pólen para semear a compra", false, "polen_products vazio");
    }

    // ── 3. personagem ───────────────────────────────────────────────────────────
    console.log("\n▶ 3. personagem da A");
    await call("GET", "/meu-mundo/admin/life", { token: tA });
    const ch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1 LIMIT 1`, [A.id_user])).rows[0];
    check("a A tem personagem (criado pelo /life)", !!ch);
    if (ch) {
      r = await call("POST", `/meu-mundo/admin/characters/${ch.id_character}/use`, { token: tB });
      check("B não acorda o personagem da A (404)", r.status === 404, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      r = await call("POST", `/meu-mundo/admin/characters/${ch.id_character}/accelerate`, { token: tB });
      check("B não acelera o personagem da A", r.status === 404 || r.status === 403, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      const still = (await pool.query(`SELECT id_user FROM tb_mm_character WHERE id_character = $1`, [ch.id_character])).rows[0];
      check("o personagem segue da A", still && still.id_user === A.id_user);
    }

    // ── 4. luta ─────────────────────────────────────────────────────────────────
    console.log("\n▶ 4. luta da A pelo ticket");
    const fight = (await pool.query(`SELECT ticket FROM tb_mm_fight WHERE id_user = $1 LIMIT 1`, [A.id_user]).catch(() => ({ rows: [] }))).rows[0];
    r = await call("POST", "/meu-mundo/admin/fight/finish", { token: tB, body: { ticket: fight ? fight.ticket : FAKE, steps: [] } });
    check("B não fecha luta que não é dele", r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

    // ── 5. chat ─────────────────────────────────────────────────────────────────
    console.log("\n▶ 5. denúncia fora do Global do jogo");
    r = await call("POST", `/meu-mundo/admin/chat/global/${FAKE}/report`, { token: tB, body: { reason: "spam" } });
    check("mensagem que não é do Global → 404", r.status === 404, String(r.status));
  } catch (e) {
    FAIL++;
    console.error(e);
  } finally {
    for (const u of users) {
      for (const sql of [
        `DELETE FROM tb_mm_mail WHERE id_user=$1`,
        `DELETE FROM tb_mm_character WHERE id_user=$1`,
        `DELETE FROM tb_mm_clan WHERE id_user=$1`,
        `DELETE FROM tb_user_role WHERE id_user=$1`,
        `DELETE FROM tb_user WHERE id_user=$1`,
      ])
        await pool.query(sql, [u.id_user]).catch(() => {});
    }
    if (server) server.close();
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await pool.end().catch(() => {});
    process.exit(FAIL ? 1 : 0);
  }
})();
