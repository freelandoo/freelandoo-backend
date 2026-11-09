// test/authz-conta.e2e.js — Segurança A1, lote 1 (conta/perfil): "quem pode o quê".
//
//   npm run test:authz
//
// Pergunta por rota: se a conta B trocar o id da URL pelo da conta A, o
// servidor recusa? E quem não tem login fica de fora do que é privado?
// Tudo pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
//
// Seções:
//   0. anônimo → 401 em toda rota de conta;
//   1. GET /users/:id (público) só devolve projeção pública — nada de e-mail,
//      telefone, nascimento, CPF, menoridade, responsável, assinatura;
//   2. perfil da A: B não edita, não apaga, não muda status/visibilidade/foto;
//   3. redes sociais do perfil da A: B não cria, não edita, não desliga;
//   4. mídia da conta A: B não edita nem apaga;
//   5. rotas de admin recusam usuário comum (403).
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
async function call(method, p, { token, body, form } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
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

async function createUser(nome) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, cpf, data_nascimento, telefone, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q',$4,'1990-01-01','11999990000',TRUE)
     RETURNING id_user, email`,
    [nome, `authz${uid()}`, `authz${uid()}@t.test`, cpfValido()]
  );
  const p = await pool.query(
    `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
     VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), $2, $3, TRUE, TRUE, TRUE)
     RETURNING id_profile`,
    [r.rows[0].id_user, nome, `conta-${uid()}`]
  );
  return { ...r.rows[0], id_profile: p.rows[0].id_profile };
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

// Campos que NUNCA podem sair numa resposta pública sobre outra pessoa.
const PRIVATE_KEYS = [
  "email", "telefone", "data_nascimento", "idade", "cpf", "cpf_masked", "has_cpf",
  "cpf_waived", "is_minor", "responsible_user_id", "preferred_locale",
  "preferred_country", "academy_onboarding_state", "onboarding_tour_done",
  "senha", "roles", "statuses", "subscription", "amount_cents", "sexo", "ativo",
];
function leakedKeys(obj, acc = new Set()) {
  if (Array.isArray(obj)) obj.forEach((x) => leakedKeys(x, acc));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (PRIVATE_KEYS.includes(k)) acc.add(k);
      leakedKeys(v, acc);
    }
  }
  return acc;
}

(async () => {
  const A = await createUser("Conta A");
  const B = await createUser("Conta B");
  const tA = tokenOf(A);
  const tB = tokenOf(B);

  // Perfil extra da A, NÃO publicado (sem assinatura) — não pode aparecer
  // na vitrine pública da conta.
  const hidden = await pool.query(
    `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible)
     VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), 'Rascunho A', $2, TRUE, FALSE)
     RETURNING id_profile`,
    [A.id_user, `rasc-${uid()}`]
  );
  const media = await pool.query(
    `INSERT INTO tb_user_media (id_user, title, media_url, media_type)
     VALUES ($1, 'Foto A', 'https://r2.test/a.jpg', 'image') RETURNING id_media`,
    [A.id_user]
  );
  const idMediaA = media.rows[0].id_media;
  const smt = await pool.query(
    `SELECT id_social_media_type FROM tb_social_media_type WHERE is_active = TRUE ORDER BY id_social_media_type LIMIT 1`
  );
  const fr = await pool.query(`SELECT id_follower_range FROM tb_follower_range ORDER BY id_follower_range LIMIT 1`);
  const typeId = smt.rows[0].id_social_media_type;
  await pool.query(
    `INSERT INTO tb_profile_social_media (id_profile, id_social_media_type, url, id_follower_range, is_active)
     VALUES ($1,$2,'https://instagram.com/conta_a',$3,TRUE)`,
    [A.id_profile, typeId, fr.rows[0].id_follower_range]
  );

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ═══ 0. anônimo ═══════════════════════════════════════════════════════
    console.log("\n━━━ 0. sem login → 401 ━━━");
    const PRIVATE_ROUTES = [
      ["GET", "/users/me"], ["PUT", "/users/me"], ["DELETE", "/users/me"],
      ["GET", "/users/me/export"], ["PUT", "/users/me/locale"], ["PUT", "/users/me/country"],
      ["GET", "/users/me/media"], ["POST", "/users/me/media"],
      ["PUT", `/users/me/media/${idMediaA}`], ["DELETE", `/users/me/media/${idMediaA}`],
      ["POST", "/users/me/onboarding/complete"],
      ["POST", "/users/me/social-media"], ["GET", "/users/me/features"], ["GET", "/users/me/quick-pills"],
      ["POST", "/profile"], ["PATCH", `/profile/${A.id_profile}`], ["DELETE", `/profile/${A.id_profile}`],
      ["POST", `/profile/${A.id_profile}/status`], ["PATCH", `/profile/${A.id_profile}/visibility`],
      ["POST", `/profile/${A.id_profile}/social-media`],
      ["GET", "/me/blocks"], ["GET", "/me/bookmarks"], ["GET", "/me/consents"],
      ["GET", "/me/verification"], ["GET", "/me/platform-avatar/pet"], ["GET", "/me/nav-counts"],
      ["GET", "/me/offerings"], ["POST", "/me/onboarding/birthdate"], ["GET", "/tours/progress"],
      ["GET", "/onboarding/intent/status"], ["GET", "/gamer/shelf"],
    ];
    for (const [m, p] of PRIVATE_ROUTES) {
      const r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p} sem token = 401`, r.status === 401, `veio ${r.status}`);
    }

    // ═══ 1. GET /users/:id é público: só projeção pública ════════════════
    console.log("\n━━━ 1. GET /users/:id não vaza dado pessoal ━━━");
    let r = await call("GET", `/users/${A.id_user}`);
    check("anônimo lê /users/:id da A (200)", r.status === 200, `veio ${r.status}`);
    const leaks = [...leakedKeys(r.body)];
    check("resposta pública sem campo pessoal", leaks.length === 0, `vazou: ${leaks.join(", ")}`);
    check("username e id_user continuam na resposta", r.body?.id_user === A.id_user && !!r.body?.username);
    const listed = (r.body?.profiles || []).map((p) => p.id_profile);
    check("perfil não publicado da A não aparece", !listed.includes(hidden.rows[0].id_profile), JSON.stringify(listed));
    r = await call("GET", `/users/${A.id_user}`, { token: tB });
    check("B logado também não vê dado pessoal da A", leakedKeys(r.body).size === 0);
    r = await call("GET", "/users/me", { token: tA });
    check("a própria A segue vendo e-mail e telefone em /users/me", r.status === 200 && r.body?.email === A.email && !!r.body?.telefone);

    // ═══ 2. perfil da A ══════════════════════════════════════════════════
    console.log("\n━━━ 2. B contra o perfil da A ━━━");
    const snapProfiles = () =>
      pool
        .query(
          `SELECT id_profile, bio, is_visible, deleted_at, avatar_url FROM tb_profile WHERE id_user = $1 ORDER BY id_profile`,
          [A.id_user]
        )
        .then((q) => JSON.stringify(q.rows));
    const pBefore = await snapProfiles();
    r = await call("PATCH", `/profile/${A.id_profile}`, { token: tB, body: { bio: "invadido" } });
    check("B não edita o perfil da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("DELETE", `/profile/${hidden.rows[0].id_profile}`, { token: tB });
    check("B não apaga perfil da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("POST", `/profile/${A.id_profile}/status`, { token: tB, body: { id_status: 1 } });
    check("B não muda status do perfil da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("PATCH", `/profile/${A.id_profile}/visibility`, { token: tB, body: { is_visible: false } });
    check("B não muda visibilidade do perfil da A (403)", r.status === 403, `veio ${r.status}`);
    const form = new FormData();
    form.append("avatar", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "a.png");
    r = await call("POST", `/profile/${A.id_profile}/avatar`, { token: tB, form });
    check("B não troca a foto do perfil da A (403)", r.status === 403, `veio ${r.status}`);
    const pAfter = await snapProfiles();
    check("banco: perfis da A intactos", pAfter === pBefore, pAfter);

    // ═══ 3. redes sociais do perfil da A ═════════════════════════════════
    console.log("\n━━━ 3. B contra as redes do perfil da A ━━━");
    r = await call("POST", `/profile/${A.id_profile}/social-media`, {
      token: tB,
      body: { id_social_media_type: typeId, url: "https://evil.test", id_follower_range: fr.rows[0].id_follower_range },
    });
    check("B não cria rede no perfil da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("PUT", `/profile/${A.id_profile}/social-media/${typeId}`, { token: tB, body: { url: "https://evil.test" } });
    check("B não edita rede do perfil da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("DELETE", `/profile/${A.id_profile}/social-media/${typeId}`, { token: tB });
    check("B não desliga rede do perfil da A (403)", r.status === 403, `veio ${r.status}`);
    const sm = await pool.query(
      `SELECT url, is_active FROM tb_profile_social_media WHERE id_profile = $1 AND id_social_media_type = $2`,
      [A.id_profile, typeId]
    );
    check("banco: rede da A intacta", sm.rows.length === 1 && sm.rows[0].is_active && sm.rows[0].url.includes("conta_a"), JSON.stringify(sm.rows));

    // ═══ 4. mídia da conta A ═════════════════════════════════════════════
    console.log("\n━━━ 4. B contra a mídia da A ━━━");
    r = await call("PUT", `/users/me/media/${idMediaA}`, { token: tB, body: { title: "invadido" } });
    check("B não edita mídia da A", r.status >= 400, `veio ${r.status}`);
    r = await call("DELETE", `/users/me/media/${idMediaA}`, { token: tB });
    check("B não apaga mídia da A", r.status >= 400, `veio ${r.status}`);
    const md = await pool.query(`SELECT title FROM tb_user_media WHERE id_media = $1`, [idMediaA]);
    check("banco: mídia da A intacta", md.rows[0]?.title === "Foto A", JSON.stringify(md.rows));

    // ═══ 5. admin ════════════════════════════════════════════════════════
    console.log("\n━━━ 5. usuário comum em rota de admin → 403 ━━━");
    const ADMIN_ROUTES = [
      ["GET", "/role"], ["POST", "/role"], ["PUT", "/role/1"], ["DELETE", "/role/1"],
      ["POST", "/legalDocuments"], ["PUT", "/legalDocuments/1"], ["POST", "/legalDocuments/1/activate"],
      ["GET", "/admin/verification"], ["PUT", "/admin/verification"],
      ["GET", "/admin/message-reports"],
    ];
    for (const [m, p] of ADMIN_ROUTES) {
      r = await call(m, p, { token: tB, body: m === "GET" ? undefined : {} });
      check(`${m} ${p} com conta comum = 403`, r.status === 403, `veio ${r.status}`);
    }
  } finally {
    server.close();
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [[A.id_user, B.id_user]]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
