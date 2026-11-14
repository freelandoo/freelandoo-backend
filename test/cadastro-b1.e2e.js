// test/cadastro-b1.e2e.js — Segurança B1 (coerência do fluxo de cadastro).
//
//   npm run test:cadastro-b1
//
// Cadastro → CPF → onboarding → primeiro perfil → publicar, pelo HTTP do app
// real, contra um Postgres LOCAL e descartável (TEST_DATABASE_URL). Cada teste
// cria e apaga as próprias contas.
//
// Seções (uma por achado do docs/auditoria/B1.md):
//   1. B1-01 conta com dispensa de identidade (mig 326) não fica presa no modal
//      de onboarding: o front pula o passo de identidade, o back aceitava só
//      com nascimento — modal que não fecha;
//   2. B1-02 cadastro "Criar meu perfil" declara a atuação NO PERFIL-CONTA (o
//      que publica de graça) em vez de nascer um segundo perfil pago — e o
//      onboarding não pede enxame/profissão de novo;
//   3. B1-03 menor + enxame com idade mínima: recusa com motivo (403), não 500
//      do trigger, no cadastro e no onboarding — e o código do responsável não
//      é gasto;
//   4. B1-04 e-mail de ativação que falha DEPOIS de a conta existir não vira
//      erro de cadastro (a pessoa tentava de novo e lia "Email já cadastrado");
//   5. B1-05 bee pela câmera (tb_story) respeita o "Usar Bees" do responsável,
//      como o bee pelo portfólio;
//   6. B1-06/B1-07 corrida de e-mail não vira 500; nascimento no futuro é
//      recusado no cadastro como já era no onboarding.
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
const bcrypt = require("bcrypt");

// O e-mail de verdade não sai. `mailFails` liga a falha do provedor (B1-04).
const mailService = require("../src/services/mailService");
const sentMails = [];
let mailFails = false;
mailService.sendActivationEmail = async (m) => {
  if (mailFails) throw new Error("provedor de e-mail fora");
  sentMails.push({ kind: "activation", ...m });
};

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
function anosAtras(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  d.setDate(d.getDate() - 3);
  return d.toISOString().slice(0, 10);
}

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const app = require("../src/app");
const SupervisionStorage = require("../src/storages/SupervisionStorage");
const AuthStorage = require("../src/storages/AuthStorage");
const { assertProfileCanPublish } = require("../src/utils/profilePaywall");

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
const createdEmails = [];
const createdIds = [];
const sessionOf = (u) =>
  jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1d" });

function signupBody(extra = {}) {
  const tag = uid();
  const email = `b1${tag}@t.test`;
  createdEmails.push(email);
  return {
    nome: `Pessoa ${tag}`,
    username: `b1${tag}`,
    email,
    senha: SENHA,
    data_nascimento: anosAtras(30),
    cpf: cpfValido(),
    ...extra,
  };
}

async function userByEmail(email) {
  const r = await pool.query(`SELECT id_user, email FROM tb_user WHERE email = $1`, [email]);
  return r.rows[0] || null;
}

// Conta como o Google cria (sem nascimento nem CPF), com o perfil-conta.
async function googleLikeUser({ waived = false } = {}) {
  const tag = uid();
  const hash = await bcrypt.hash(SENHA, 4);
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, ativo, cpf_waived_until)
     VALUES ($1,$2,$3,$4,TRUE, CASE WHEN $5 THEN NOW() + INTERVAL '7 days' ELSE NULL END)
     RETURNING id_user, email`,
    [`Google ${tag}`, `g${tag}`, `g${tag}@t.test`, hash, waived]
  );
  const u = r.rows[0];
  createdIds.push(u.id_user);
  await AuthStorage.ensureUserAccountProfile(pool, u.id_user, `Google ${tag}`);
  return u;
}

async function adultWithInvite() {
  const tag = uid();
  const hash = await bcrypt.hash(SENHA, 4);
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, ativo, cpf, data_nascimento)
     VALUES ($1,$2,$3,$4,TRUE,$5,$6) RETURNING id_user`,
    [`Resp ${tag}`, `r${tag}`, `r${tag}@t.test`, hash, cpfValido(), anosAtras(40)]
  );
  createdIds.push(r.rows[0].id_user);
  const code = `B1${tag}`.toUpperCase().slice(0, 10);
  await SupervisionStorage.createInvite(pool, {
    responsibleUserId: r.rows[0].id_user,
    code,
    expiresAt: new Date(Date.now() + 3600e3),
  });
  return code;
}
async function inviteStatus(code) {
  const r = await pool.query(`SELECT status FROM parental_invites WHERE code = $1`, [code]);
  return r.rows[0]?.status;
}

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  const cat = (
    await pool.query(
      `SELECT c.id_category, c.id_machine FROM tb_category c JOIN tb_machine m USING (id_machine)
        WHERE c.is_active AND m.min_age IS NULL ORDER BY c.id_category DESC LIMIT 1`
    )
  ).rows[0];
  const adultCat = (
    await pool.query(
      `SELECT c.id_category, c.id_machine FROM tb_category c JOIN tb_machine m USING (id_machine)
        WHERE c.is_active AND m.min_age IS NOT NULL LIMIT 1`
    )
  ).rows[0];
  const region = (await pool.query(`SELECT id_region, uf FROM tb_region WHERE is_active LIMIT 1`)).rows[0];

  try {
    // ═══ 1. dispensa de identidade ═══════════════════════════════════════
    console.log("\n━━━ 1. B1-01 conta com dispensa não fica presa no onboarding ━━━");
    const W = await googleLikeUser({ waived: true });
    let r = await call("GET", "/users/me", { token: sessionOf(W) });
    check("o /me diz 'dispensada' e sem atuação (o front abre só o passo de atuação)",
      r.body?.cpf_waived === true && r.body?.account_profile && !r.body.account_profile.has_taxonomy,
      JSON.stringify({ w: r.body?.cpf_waived, acc: r.body?.account_profile?.has_taxonomy }));
    // Exatamente o que o modal manda nesse caso: sem nascimento e sem CPF.
    r = await call("POST", "/me/onboarding/birthdate", {
      token: sessionOf(W),
      body: { id_machine: cat.id_machine, id_category: cat.id_category, estado: "SP", municipio: "Campinas" },
    });
    check("onboarding só com a atuação passa (antes: 'Data de nascimento é obrigatória')",
      r.status === 200, `veio ${r.status} ${JSON.stringify(r.body)}`);
    const wRow = await pool.query(
      `SELECT u.cpf, u.data_nascimento, p.taxonomy_declared_at IS NOT NULL AS tax
         FROM tb_user u JOIN tb_profile p ON p.id_user = u.id_user AND p.is_user_account
        WHERE u.id_user = $1`, [W.id_user]);
    check("a dispensa não inventa CPF nem nascimento", wRow.rows[0]?.cpf === null && wRow.rows[0]?.data_nascimento === null);
    check("a atuação foi gravada no perfil-conta", wRow.rows[0]?.tax === true);
    const W2 = await googleLikeUser({ waived: false });
    r = await call("POST", "/me/onboarding/birthdate", {
      token: sessionOf(W2),
      body: { id_machine: cat.id_machine, id_category: cat.id_category, estado: "SP", municipio: "Campinas" },
    });
    check("sem dispensa, o nascimento continua obrigatório", r.status === 400, `veio ${r.status}`);

    // ═══ 2. cadastro de vendedor ═════════════════════════════════════════
    console.log("\n━━━ 2. B1-02 'Criar meu perfil' no cadastro = o perfil-conta ━━━");
    const sb = signupBody({
      id_machine: cat.id_machine,
      id_category: cat.id_category,
      display_name: "Ateliê Teste",
      bio: "faço coisas",
      estado: region.uf,
      id_region: region.id_region,
    });
    r = await call("POST", "/auth/signup", { body: sb });
    check("cadastro de vendedor aceito", r.status === 200 || r.status === 201, `veio ${r.status} ${JSON.stringify(r.body)}`);
    const S = await userByEmail(sb.email);
    const profs = await pool.query(
      `SELECT id_profile, is_user_account, id_category, display_name, bio, id_region,
              taxonomy_declared_at IS NOT NULL AS tax
         FROM tb_profile WHERE id_user = $1 AND deleted_at IS NULL`, [S?.id_user]);
    check("nasce UM perfil (o da conta), não um segundo perfil pago",
      profs.rowCount === 1 && profs.rows[0].is_user_account === true,
      JSON.stringify(profs.rows.map((p) => ({ acc: p.is_user_account, cat: p.id_category }))));
    const acc = profs.rows.find((p) => p.is_user_account);
    check("o perfil-conta leva a profissão, o nome de exibição, a bio e a região escolhidos",
      acc && Number(acc.id_category) === Number(cat.id_category) && acc.display_name === "Ateliê Teste" &&
        acc.bio === "faço coisas" && Number(acc.id_region) === Number(region.id_region),
      JSON.stringify(acc));
    check("a atuação conta como declarada (o onboarding não pede de novo)", acc?.tax === true);
    const escolhido = profs.rows.find((p) => Number(p.id_category) === Number(cat.id_category));
    check("o perfil com a profissão escolhida no cadastro publica sem assinatura",
      !!escolhido && (await assertProfileCanPublish(pool, escolhido.id_profile)) === null,
      escolhido ? JSON.stringify(await assertProfileCanPublish(pool, escolhido.id_profile)) : "sem perfil");
    const sb2 = signupBody();
    r = await call("POST", "/auth/signup", { body: sb2 });
    const C = await userByEmail(sb2.email);
    const cProf = await pool.query(
      `SELECT count(*)::int AS n, bool_and(taxonomy_declared_at IS NULL) AS sem_tax
         FROM tb_profile WHERE id_user = $1`, [C?.id_user]);
    check("cadastro de quem só contrata segue com o perfil-conta sem atuação (onboarding pede)",
      r.status < 300 && cProf.rows[0].n === 1 && cProf.rows[0].sem_tax === true, JSON.stringify(cProf.rows[0]));

    // ═══ 3. menor × enxame +18 ═══════════════════════════════════════════
    console.log("\n━━━ 3. B1-03 menor em enxame com idade mínima: motivo, não 500 ━━━");
    const code1 = await adultWithInvite();
    const sm = signupBody({
      data_nascimento: anosAtras(15),
      responsible_code: code1,
      id_machine: adultCat.id_machine,
      id_category: adultCat.id_category,
      display_name: "Menor",
      estado: region.uf,
      id_region: region.id_region,
    });
    r = await call("POST", "/auth/signup", { body: sm });
    check("cadastro: 403 com a frase da idade mínima", r.status === 403 && /maiores de 18/.test(r.body?.error || ""),
      `veio ${r.status} ${JSON.stringify(r.body)}`);
    check("cadastro recusado não deixa conta", !(await userByEmail(sm.email)));
    check("o código do responsável não foi gasto", (await inviteStatus(code1)) !== "used", await inviteStatus(code1));

    const code2 = await adultWithInvite();
    const G = await googleLikeUser();
    r = await call("POST", "/me/onboarding/birthdate", {
      token: sessionOf(G),
      body: {
        data_nascimento: anosAtras(15), cpf: cpfValido(), responsible_code: code2,
        id_machine: adultCat.id_machine, id_category: adultCat.id_category, estado: "SP", municipio: "Campinas",
      },
    });
    check("onboarding: 403 com a frase da idade mínima", r.status === 403 && /maiores de 18/.test(r.body?.error || ""),
      `veio ${r.status} ${JSON.stringify(r.body)}`);
    const gRow = await pool.query(`SELECT cpf, data_nascimento, is_minor FROM tb_user WHERE id_user = $1`, [G.id_user]);
    check("onboarding recusado não grava nada", gRow.rows[0].cpf === null && gRow.rows[0].data_nascimento === null);
    check("o código do responsável não foi gasto", (await inviteStatus(code2)) !== "used", await inviteStatus(code2));
    const ga = await googleLikeUser();
    r = await call("POST", "/me/onboarding/birthdate", {
      token: sessionOf(ga),
      body: {
        data_nascimento: anosAtras(30), cpf: cpfValido(),
        id_machine: adultCat.id_machine, id_category: adultCat.id_category, estado: "SP", municipio: "Campinas",
      },
    });
    check("adulto escolhe o enxame +18 normalmente", r.status === 200, `veio ${r.status} ${JSON.stringify(r.body)}`);

    // ═══ 4. e-mail de ativação ═══════════════════════════════════════════
    console.log("\n━━━ 4. B1-04 e-mail que falha depois da conta criada ━━━");
    mailFails = true;
    const se = signupBody();
    r = await call("POST", "/auth/signup", { body: se });
    mailFails = false;
    const E = await userByEmail(se.email);
    check("a conta existe", !!E);
    check("e a resposta é de sucesso (antes: 500 e a pessoa tentava de novo)", r.status < 300,
      `veio ${r.status} ${JSON.stringify(r.body)}`);
    r = await call("POST", "/auth/signin", { body: { email: se.email, senha: SENHA } });
    check("ela entra e vê 'e-mail não confirmado' (a tela tem o reenviar)",
      r.status === 200 && r.body?.email_verified === false, `veio ${r.status}`);

    // ═══ 5. bee pela câmera × "Usar Bees" ════════════════════════════════
    console.log("\n━━━ 5. B1-05 bee pela câmera respeita o 'Usar Bees' ━━━");
    const code3 = await adultWithInvite();
    const sk = signupBody({ data_nascimento: anosAtras(15), responsible_code: code3 });
    r = await call("POST", "/auth/signup", { body: sk });
    const K = await userByEmail(sk.email);
    check("menor supervisionado cadastrado", !!K, `veio ${r.status} ${JSON.stringify(r.body)}`);
    if (K) {
      await pool.query(
        `UPDATE minor_permissions SET can_use_bees = FALSE, can_post_feed = TRUE WHERE minor_user_id = $1`,
        [K.id_user]);
      const kp = (await pool.query(
        `SELECT id_profile FROM tb_profile WHERE id_user = $1 AND is_user_account`, [K.id_user])).rows[0];
      r = await call("POST", "/me/stories/upload-url", {
        token: sessionOf(K), body: { id_profile: kp.id_profile, media_type: "video" },
      });
      check("câmera recusa o bee quando o responsável desligou 'Usar Bees'",
        r.status === 403 && /can_use_bees/.test(r.body?.error || ""), `veio ${r.status} ${JSON.stringify(r.body)}`);
    }

    // ═══ 6. corrida de e-mail e nascimento no futuro ═════════════════════
    console.log("\n━━━ 6. B1-06/B1-07 corrida de e-mail; nascimento no futuro ━━━");
    const tag = uid();
    const mesmo = `b1corrida${tag}@t.test`;
    createdEmails.push(mesmo);
    const corrida = await Promise.all([0, 1, 2].map((i) =>
      call("POST", "/auth/signup", { body: { ...signupBody(), email: mesmo, username: `b1c${i}${tag}` } })));
    const st = corrida.map((x) => x.status);
    check("três cadastros simultâneos com o mesmo e-mail: um passa, nenhum 500",
      st.filter((s) => s < 300).length === 1 && !st.includes(500), JSON.stringify(st));

    r = await call("POST", "/auth/signup", { body: signupBody({ data_nascimento: "2999-01-01" }) });
    check("nascimento no futuro recusado no cadastro como data inválida (como no onboarding)",
      r.status === 400 && /nascimento/i.test(r.body?.error || ""), `veio ${r.status} ${JSON.stringify(r.body)}`);
    r = await call("POST", "/auth/signup", { body: signupBody({ data_nascimento: "1850-01-01" }) });
    check("nascimento há mais de 120 anos recusado", r.status === 400, `veio ${r.status}`);
  } finally {
    server.close();
    // Os e-mails de ativação disparam depois da resposta: dá tempo de sair.
    await new Promise((r) => setTimeout(r, 300));
    await pool
      .query(`DELETE FROM tb_user WHERE email = ANY($1::text[]) OR id_user = ANY($2::uuid[])`, [createdEmails, createdIds])
      .catch((e) => console.log("limpeza:", e.message));
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
