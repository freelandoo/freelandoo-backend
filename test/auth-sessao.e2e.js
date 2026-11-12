// test/auth-sessao.e2e.js — Segurança A3 (login e sessão).
//
//   npm run test:auth-sessao
//
// Pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
// Cada teste cria e apaga as próprias contas.
//
// Seções:
//   1. só o token de SESSÃO abre a porta: algoritmo fixo (HS256), validade
//      obrigatória, token de outro propósito (estado do "conectar Steam")
//      recusado; os tokens emitidos hoje continuam valendo;
//   2. login: bloqueio progressivo por CONTA (não só por IP), igual para
//      e-mail que existe e que não existe; acerto limpa o contador;
//   3. recuperação de senha: senha fraca recusada, token de uso único, os
//      outros pedidos em aberto caem, a troca libera o bloqueio;
//   4. login Google numa conta nunca confirmada derruba a senha que estava
//      lá (pré-sequestro: quem cadastrou o e-mail alheio não entra mais);
//   5. PUT /users/me não troca a data de nascimento (gate de idade).
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
process.env.GOOGLE_CLIENT_ID = "cliente-de-teste.apps.googleusercontent.com";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

// Google falso: o "credential" é o próprio JSON do payload. Instalado ANTES de
// carregar o app (o AuthService cria o cliente na carga do módulo).
const { OAuth2Client } = require("google-auth-library");
OAuth2Client.prototype.verifyIdToken = async function ({ idToken, audience }) {
  if (audience !== process.env.GOOGLE_CLIENT_ID) throw new Error("audiência errada");
  const payload = JSON.parse(Buffer.from(idToken, "base64url").toString("utf8"));
  return { getPayload: () => payload };
};

// O e-mail de verdade não sai: o mailService é trocado por um gravador.
const mailService = require("../src/services/mailService");
const sentMails = [];
mailService.sendActivationEmail = async (m) => { sentMails.push({ kind: "activation", ...m }); };
mailService.sendPasswordResetEmail = async (m) => { sentMails.push({ kind: "reset", ...m }); };

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
function cpfValido() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (d.every((x) => x === d[0])) d[0] = (d[0] + 1) % 10;
  const dig = (arr) => {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * (arr.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dig(d));
  d.push(dig(d));
  return d.join("");
}

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

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

const SENHA = "Senha#Forte1";
const created = [];
async function createUser({ ativo = true, senha = SENHA } = {}) {
  const hash = senha ? await bcrypt.hash(senha, 4) : null;
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, cpf, data_nascimento, telefone, ativo)
     VALUES ($1,$2,$3,$4,$5,'2010-05-05','11999990000',$6)
     RETURNING id_user, email`,
    [`Conta ${uid()}`, `a3${uid()}`, `a3${uid()}@t.test`, hash, cpfValido(), ativo]
  );
  created.push(r.rows[0].id_user);
  return r.rows[0];
}
// O token exatamente como o login emite hoje.
const sessionOf = (u) =>
  jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1d" });

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    const A = await createUser();

    // ═══ 1. token de sessão ══════════════════════════════════════════════
    console.log("\n━━━ 1. só o token de sessão abre a porta ━━━");
    let r = await call("GET", "/users/me", { token: sessionOf(A) });
    check("token emitido hoje (HS256, 1 dia) segue valendo", r.status === 200, `veio ${r.status}`);

    const hs512 = jwt.sign({ id_user: A.id_user, email: A.email }, process.env.JWT_SECRET, {
      algorithm: "HS512", expiresIn: "1h",
    });
    r = await call("GET", "/users/me", { token: hs512 });
    check("token HS512 recusado (algoritmo fixo)", r.status === 401, `veio ${r.status}`);

    const semValidade = jwt.sign({ id_user: A.id_user, email: A.email }, process.env.JWT_SECRET);
    r = await call("GET", "/users/me", { token: semValidade });
    check("token sem validade (exp) recusado", r.status === 401, `veio ${r.status}`);

    // Estado do "conectar Steam" como o código antigo emitia: mesmo segredo,
    // tem id_user, viaja na URL de volta da Steam.
    const estadoSteam = jwt.sign(
      { id_user: A.id_user, provider: "steam", purpose: "game_connect", back: "/gamer" },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );
    r = await call("GET", "/users/me", { token: estadoSteam });
    check("estado do 'conectar Steam' não vale como login", r.status === 401, `veio ${r.status}`);
    r = await call("GET", `/users/${A.id_user}`, { token: estadoSteam });
    check("estado do 'conectar Steam' nem como login opcional quebra rota pública", r.status === 200, `veio ${r.status}`);

    // O estado novo não é aceito como sessão nem com o segredo do JWT.
    let GameStateToken;
    try {
      GameStateToken = require("../src/utils/sessionToken");
    } catch {
      GameStateToken = null;
    }
    check("módulo único de token de sessão existe (utils/sessionToken)", !!GameStateToken);
    if (GameStateToken) {
      const novo = GameStateToken.signPurposeToken("game_connect", { id_user: A.id_user, provider: "steam" }, "10m");
      let aceitouComoSessao = true;
      try {
        jwt.verify(novo, process.env.JWT_SECRET);
      } catch {
        aceitouComoSessao = false;
      }
      check("estado novo é assinado com chave própria (não abre com o JWT_SECRET)", !aceitouComoSessao);
      const lido = GameStateToken.verifyPurposeToken("game_connect", novo);
      check("estado novo volta com o mesmo conteúdo", lido?.id_user === A.id_user && lido?.provider === "steam");
      check("estado de um propósito não serve a outro", GameStateToken.verifyPurposeToken("outro", novo) === null);
    }

    // ═══ 2. bloqueio por conta ═══════════════════════════════════════════
    console.log("\n━━━ 2. login: bloqueio progressivo por conta ━━━");
    const B = await createUser();
    for (let i = 0; i < 5; i++) {
      r = await call("POST", "/auth/signin", { body: { email: B.email, senha: "Errada#123" } });
    }
    check("5ª senha errada ainda responde 'inválidos'", r.status === 400 || r.status === 401, `veio ${r.status}`);
    r = await call("POST", "/auth/signin", { body: { email: B.email, senha: SENHA } });
    check("depois de 5 erros, nem a senha certa entra na hora (429)", r.status === 429, `veio ${r.status}`);
    check("a resposta diz quando tentar de novo", /minuto/i.test(r.body?.error || ""), JSON.stringify(r.body));

    const fantasma = `naoexiste${uid()}@t.test`;
    for (let i = 0; i < 5; i++) {
      await call("POST", "/auth/signin", { body: { email: fantasma, senha: "Errada#123" } });
    }
    r = await call("POST", "/auth/signin", { body: { email: fantasma, senha: "Errada#123" } });
    check("e-mail que não existe bloqueia igual (não entrega quem tem conta)", r.status === 429, `veio ${r.status}`);

    const C = await createUser();
    for (let i = 0; i < 3; i++) {
      await call("POST", "/auth/signin", { body: { email: C.email, senha: "Errada#123" } });
    }
    r = await call("POST", "/auth/signin", { body: { email: C.email, senha: SENHA } });
    check("3 erros e a senha certa: entra", r.status === 200 && !!r.body?.token, `veio ${r.status}`);
    for (let i = 0; i < 4; i++) {
      await call("POST", "/auth/signin", { body: { email: C.email, senha: "Errada#123" } });
    }
    r = await call("POST", "/auth/signin", { body: { email: C.email, senha: SENHA } });
    check("o acerto zerou o contador (mais 4 erros não bloqueiam)", r.status === 200, `veio ${r.status}`);

    // ═══ 3. recuperação de senha ═════════════════════════════════════════
    console.log("\n━━━ 3. recuperação de senha ━━━");
    r = await call("POST", "/auth/forgot-password", { body: { email: `ninguem${uid()}@t.test` } });
    const generica = r.body?.message;
    r = await call("POST", "/auth/forgot-password", { body: { email: B.email } });
    check("pedido de recuperação: mesma resposta para quem existe e quem não", r.body?.message === generica && r.status === 200, JSON.stringify(r.body));
    await call("POST", "/auth/forgot-password", { body: { email: B.email } });
    const links = sentMails.filter((m) => m.kind === "reset" && m.to === B.email).map((m) => new URL(m.link).searchParams.get("token"));
    check("dois pedidos geraram dois links", links.length === 2, `veio ${links.length}`);

    r = await call("POST", "/auth/reset-password", { body: { token: links[0], novaSenha: "fraca" } });
    check("senha fraca recusada na troca", r.status === 400, `veio ${r.status}`);
    const NOVA = "Outra#Senha9";
    r = await call("POST", "/auth/reset-password", { body: { token: links[0], novaSenha: NOVA } });
    check("troca com o link 1", r.status === 200, `veio ${r.status} ${JSON.stringify(r.body)}`);
    r = await call("POST", "/auth/reset-password", { body: { token: links[0], novaSenha: "Mais#Uma123" } });
    check("link 1 não serve duas vezes", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", "/auth/reset-password", { body: { token: links[1], novaSenha: "Mais#Uma123" } });
    check("link 2 (pedido anterior em aberto) caiu com a troca", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", "/auth/signin", { body: { email: B.email, senha: NOVA } });
    check("a troca de senha libera o bloqueio da conta", r.status === 200, `veio ${r.status}`);

    // ═══ 4. Google × conta nunca confirmada ══════════════════════════════
    console.log("\n━━━ 4. login Google em conta nunca confirmada ━━━");
    const D = await createUser({ ativo: false });
    const cred = (email, sub) =>
      Buffer.from(JSON.stringify({ sub, email, email_verified: true, name: "Dona Real" })).toString("base64url");
    r = await call("POST", "/auth/google-signin", { body: { credential: cred(D.email, `g${uid()}`) } });
    check("a dona do e-mail entra pelo Google", r.status === 200 && !!r.body?.token, `veio ${r.status}`);
    const dRow = await pool.query(`SELECT senha IS NULL AS sem_senha, ativo, google_sub FROM tb_user WHERE id_user = $1`, [D.id_user]);
    check("a senha de quem cadastrou o e-mail sem confirmar foi derrubada", dRow.rows[0]?.sem_senha === true, JSON.stringify(dRow.rows[0]));
    r = await call("POST", "/auth/signin", { body: { email: D.email, senha: SENHA } });
    check("a senha antiga não entra mais", r.status !== 200, `veio ${r.status}`);

    const E = await createUser({ ativo: true });
    r = await call("POST", "/auth/google-signin", { body: { credential: cred(E.email, `g${uid()}`) } });
    const eRow = await pool.query(`SELECT senha IS NOT NULL AS tem_senha FROM tb_user WHERE id_user = $1`, [E.id_user]);
    check("conta confirmada mantém a senha ao ligar o Google", r.status === 200 && eRow.rows[0]?.tem_senha === true, `veio ${r.status}`);
    r = await call("POST", "/auth/google-signin", { body: { credential: cred(`x${uid()}@t.test`, `g${uid()}`).slice(0, -2) + "zz" } });
    check("credencial Google ilegível = recusada", r.status >= 400, `veio ${r.status}`);

    // ═══ 5. PUT /users/me ════════════════════════════════════════════════
    console.log("\n━━━ 5. PUT /users/me não troca o nascimento ━━━");
    const F = await createUser();
    r = await call("PUT", "/users/me", { token: sessionOf(F), body: { data_nascimento: "1980-01-01", bio: "oi" } });
    const fRow = await pool.query(`SELECT to_char(data_nascimento,'YYYY-MM-DD') AS d, bio FROM tb_user WHERE id_user = $1`, [F.id_user]);
    check("bio troca normalmente", fRow.rows[0]?.bio === "oi", `veio ${r.status} ${JSON.stringify(fRow.rows[0])}`);
    check("nascimento fica o do cadastro (menor não vira adulto)", fRow.rows[0]?.d === "2010-05-05", JSON.stringify(fRow.rows[0]));
  } finally {
    server.close();
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [created]).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE email LIKE 'x%@t.test' AND google_sub LIKE 'g%'`).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
