// test/academy-partner.e2e.js
// API de parceiro de academia + primeiro acesso + aceite/recusa + validade dos
// treinos (mig 296), ponta a ponta pelo HTTP do app real.
//
// Roda: TEST_DATABASE_URL=postgres://...@localhost:PORT/db npm run test:academy-partner
// Só Postgres LOCAL e descartável, com TODAS as migrations aplicadas (o teste
// reaplica a 296 para provar idempotência e mexe em dados livremente).
// O R2 é substituído por um dublê em memória (nenhuma chamada de rede).
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

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

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

const uid = () => crypto.randomBytes(4).toString("hex");

// ─── Dublê do R2 ────────────────────────────────────────────────────────────
const academyPhoto = require("../src/integrations/r2/academyPhoto");
const r2Store = new Map();
academyPhoto.putAcademyPhoto = async ({ id_academy, id_user, buffer, mimetype }) => {
  const key = `academy-photos/${id_academy}/${id_user}-${crypto.randomUUID()}.jpg`;
  r2Store.set(key, { buffer, mimetype });
  return key;
};
academyPhoto.getAcademyPhoto = async (key) => ({ body: r2Store.get(key).buffer, contentType: r2Store.get(key).mimetype });
academyPhoto.copyAcademyPhotoToAvatar = async ({ key, id_user }) => {
  if (!r2Store.has(key)) throw new Error("no such key");
  return `https://r2.test/avatars/${id_user}-copia.jpg`;
};
academyPhoto.deleteAcademyPhoto = async (key) => {
  r2Store.delete(key);
};

const pool = require("../src/databases");
const app = require("../src/app");

let base;
async function call(method, p, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) payload = raw;
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
  return { status: res.status, body: json, headers: res.headers };
}

async function createPlainUser({ nome, cpf, email }) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, cpf, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q',$4,'1990-01-01',TRUE)
     RETURNING id_user, senha`,
    [nome, `u${uid()}`, email, cpf]
  );
  await pool.query(
    `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
     VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), $2, $3, TRUE, FALSE, TRUE)`,
    [r.rows[0].id_user, nome, `conta-${uid()}`]
  );
  return r.rows[0];
}

const userJwt = (id_user, email = "x@x.test") => jwt.sign({ id_user, email }, process.env.JWT_SECRET, { expiresIn: "1h" });

(async () => {
  // ─── Migração ──────────────────────────────────────────────────────────────
  const migSql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/296_academy_partner_access.sql"), "utf8");
  await pool.query(migSql);
  await pool.query(migSql);
  check("mig 296 aplica duas vezes (idempotente)", true);

  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE WHERE flag_key = 'fitness_academias'`);

  const owner = await createPlainUser({ nome: "Dono Academia", cpf: cpfValido(), email: `dono${uid()}@t.test` });
  const ownerB = await createPlainUser({ nome: "Dono B", cpf: cpfValido(), email: `donob${uid()}@t.test` });
  const ac = await pool.query(
    `INSERT INTO tb_academy (id_owner_user, nome, slug, api_base_url, api_token_enc)
     VALUES ($1,'Academia Teste',$2,'https://example.test','x'), ($3,'Academia B',$4,'https://example.test','x')
     RETURNING id_academy, slug`,
    [owner.id_user, `acad-${uid()}`, ownerB.id_user, `acadb-${uid()}`]
  );
  const [academyA, academyB] = ac.rows;

  // Validade: o UPDATE da migração dá 90 aos planos existentes.
  await pool.query(`ALTER TABLE tb_workout_plan DROP CONSTRAINT IF EXISTS chk_workout_plan_validade_dias`);
  await pool.query(`ALTER TABLE tb_workout_plan DROP COLUMN validade_dias`);
  const oldPlan = await pool.query(
    `INSERT INTO tb_workout_plan (id_user, created_by, nome) VALUES ($1,$1,'Plano antigo') RETURNING id_plan`,
    [owner.id_user]
  );
  await pool.query(migSql);
  const op = await pool.query(`SELECT validade_dias FROM tb_workout_plan WHERE id_plan = $1`, [oldPlan.rows[0].id_plan]);
  check("migração: plano existente fica com 90 dias", op.rows[0].validade_dias === 90, JSON.stringify(op.rows[0]));
  const np = await pool.query(
    `INSERT INTO tb_workout_plan (id_user, created_by, nome) VALUES ($1,$1,'Novo') RETURNING validade_dias`,
    [owner.id_user]
  );
  check("migração: plano novo nasce com 60 (DEFAULT)", np.rows[0].validade_dias === 60);
  let ckErr = null;
  try {
    await pool.query(`INSERT INTO tb_workout_plan (id_user, created_by, nome, validade_dias) VALUES ($1,$1,'x',45)`, [owner.id_user]);
  } catch (e) {
    ckErr = e;
  }
  check("migração: CHECK recusa validade fora de 30/60/90", ckErr && ckErr.code === "23514");
  await pool.query(`DELETE FROM tb_workout_plan WHERE id_user = $1`, [owner.id_user]);

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ─── Chave de parceiro ─────────────────────────────────────────────────
    const tOwner = userJwt(owner.id_user);
    const tOwnerB = userJwt(ownerB.id_user);
    let r = await call("GET", `/academies/${academyA.id_academy}/partner-key`, { token: tOwner });
    check("chave: status antes de gerar = não existe", r.status === 200 && r.body.existe === false, JSON.stringify(r.body));
    r = await call("POST", `/academies/${academyA.id_academy}/partner-key`, { token: tOwnerB });
    check("chave: quem não é dono não gera (403)", r.status === 403);
    r = await call("POST", `/academies/${academyA.id_academy}/partner-key`, { token: tOwner });
    const keyA0 = r.body.chave;
    check("chave: dono gera flnd_parc_…", r.status === 201 && /^flnd_parc_/.test(keyA0 || ""), JSON.stringify(r.body));
    r = await call("POST", `/academies/${academyA.id_academy}/partner-key`, { token: tOwner });
    const keyA = r.body.chave;
    check("chave: rotação gera outra", keyA && keyA !== keyA0);
    const stored = await pool.query(`SELECT partner_key_hash FROM tb_academy WHERE id_academy = $1`, [academyA.id_academy]);
    check("chave: banco guarda só o hash", stored.rows[0].partner_key_hash === crypto.createHash("sha256").update(keyA).digest("hex"));
    r = await call("GET", `/academies/${academyA.id_academy}/partner-key`, { token: tOwner });
    check("chave: status depois = existe + criado_em", r.body.existe === true && !!r.body.criado_em);
    r = await call("POST", `/academies/${academyB.id_academy}/partner-key`, { token: tOwnerB });
    const keyB = r.body.chave;

    // ─── Auth do parceiro ──────────────────────────────────────────────────
    r = await call("GET", "/partner/v1/members");
    check("auth: sem chave → 401 chave_invalida", r.status === 401 && r.body.erro === "chave_invalida");
    r = await call("GET", "/partner/v1/members", { token: "flnd_parc_" + "x".repeat(43) });
    check("auth: chave desconhecida → 401", r.status === 401 && r.body.erro === "chave_invalida");
    r = await call("GET", "/partner/v1/members", { token: keyA0 });
    check("auth: chave rotacionada para de valer → 401", r.status === 401);
    r = await call("GET", "/partner/v1/members", { token: keyA });
    check("auth: chave válida → 200", r.status === 200 && Array.isArray(r.body.itens));

    // A API de parceiro funciona com a flag global desligada.
    await pool.query(`UPDATE tb_feature_flag SET is_enabled = FALSE WHERE flag_key = 'fitness_academias'`);
    require("../src/services/FeatureFlagService").invalidate?.();
    r = await call("GET", "/partner/v1/members", { token: keyA });
    check("auth: parceiro independe da flag fitness_academias", r.status === 200, String(r.status));
    await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE WHERE flag_key = 'fitness_academias'`);
    require("../src/services/FeatureFlagService").invalidate?.();

    // ─── POST /members: validação ──────────────────────────────────────────
    const adulto = { nome: "Maria José da Silva", email: `maria${uid()}@t.test`, data_nascimento: "1995-03-10" };
    r = await call("POST", "/partner/v1/members", { token: keyA, body: { ...adulto, cpf: "12345678900" } });
    check("validação: CPF com dígito errado → 422 cpf_invalido", r.status === 422 && r.body.erro === "cpf_invalido");
    r = await call("POST", "/partner/v1/members", { token: keyA, body: { cpf: cpfValido(), nome: "Sem Email", data_nascimento: "1990-01-01" } });
    check("validação: sem e-mail → 422 dados_incompletos", r.status === 422 && r.body.erro === "dados_incompletos");
    const hoje = new Date();
    const menor = `${hoje.getFullYear() - 17}-01-01`;
    r = await call("POST", "/partner/v1/members", { token: keyA, body: { ...adulto, cpf: cpfValido(), data_nascimento: menor } });
    check("validação: 17 anos → 422 menor_de_idade", r.status === 422 && r.body.erro === "menor_de_idade");

    // ─── Criar + idempotência ──────────────────────────────────────────────
    const cpfMaria = cpfValido();
    r = await call("POST", "/partner/v1/members", {
      token: keyA,
      body: { ...adulto, cpf: cpfMaria, telefone: "5511999998888", ref_externa: "pessoa-123" },
    });
    const maria = r.body;
    check("criar: 201 criado + aguardando_aceite", r.status === 201 && maria.status === "criado" && maria.estado === "aguardando_aceite", JSON.stringify(r.body));
    check(
      "criar: link no formato /academia/<slug>/primeiro-acesso?token=",
      typeof maria.link_primeiro_acesso === "string" &&
        maria.link_primeiro_acesso.startsWith(`https://freelandoo.test/academia/${academyA.slug}/primeiro-acesso?token=`)
    );
    const exp = new Date(maria.expira_em).getTime() - Date.now();
    check("criar: link vale ~7 dias", exp > 6.9 * 864e5 && exp < 7.1 * 864e5);
    const u = (await pool.query(`SELECT * FROM tb_user WHERE id_user = $1`, [maria.id_user])).rows[0];
    check("criar: senha NULL, inativa, estado aguardando", u.senha === null && u.ativo === false && u.academy_onboarding_state === "aguardando_aceite");
    check("criar: username nome.sobrenome", u.username === "maria.silva" || /^maria\.silva\d+$/.test(u.username), u.username);
    check("criar: telefone e CPF gravados", u.telefone === "5511999998888" && u.cpf === cpfMaria);
    const accProf = await pool.query(`SELECT 1 FROM tb_profile WHERE id_user = $1 AND is_user_account`, [maria.id_user]);
    check("criar: perfil-conta criado", accProf.rowCount === 1);
    const mm = (await pool.query(`SELECT * FROM tb_academy_member WHERE id_user = $1`, [maria.id_user])).rows[0];
    check("criar: vínculo com ref_externa", mm && mm.id_academy === academyA.id_academy && mm.ref_externa === "pessoa-123");

    r = await call("POST", "/partner/v1/members", { token: keyA, body: { ...adulto, cpf: cpfMaria, ref_externa: "pessoa-123" } });
    check("idempotência: 2ª chamada → 200 vinculado, mesma conta", r.status === 200 && r.body.status === "vinculado" && r.body.id_user === maria.id_user && r.body.estado === "aguardando_aceite", JSON.stringify(r.body));
    const nUsers = await pool.query(`SELECT COUNT(*)::int n FROM tb_user WHERE cpf = $1`, [cpfMaria]);
    check("idempotência: uma conta só", nUsers.rows[0].n === 1);

    // Concorrência: duas chamadas simultâneas com CPF novo → uma conta só.
    const cpfCorrida = cpfValido();
    const corpoCorrida = { nome: "Corrida Teste", email: `corrida${uid()}@t.test`, data_nascimento: "1990-05-05", cpf: cpfCorrida };
    const [c1, c2] = await Promise.all([
      call("POST", "/partner/v1/members", { token: keyA, body: corpoCorrida }),
      call("POST", "/partner/v1/members", { token: keyA, body: corpoCorrida }),
    ]);
    const nCorrida = await pool.query(`SELECT COUNT(*)::int n FROM tb_user WHERE cpf = $1`, [cpfCorrida]);
    check(
      "idempotência sob corrida: 201 + 200, uma conta",
      nCorrida.rows[0].n === 1 && [c1.status, c2.status].sort().join(",") === "200,201",
      `${c1.status},${c2.status}`
    );

    r = await call("POST", "/partner/v1/members", { token: keyA, body: { ...adulto, cpf: cpfValido() } });
    check("email_em_uso: outro CPF com o mesmo e-mail → 409", r.status === 409 && r.body.erro === "email_em_uso");

    // CPF que já tem conta comum: só vincula, nunca mexe na senha.
    const cpfJoao = cpfValido();
    const joao = await createPlainUser({ nome: "João Antigo", cpf: cpfJoao, email: `joao${uid()}@t.test` });
    r = await call("POST", "/partner/v1/members", {
      token: keyA,
      body: { cpf: cpfJoao, nome: "João Antigo", email: `outro${uid()}@t.test`, data_nascimento: "1980-01-01" },
    });
    check("vincular: conta existente → 200 vinculado + ativa", r.status === 200 && r.body.status === "vinculado" && r.body.estado === "ativa" && r.body.id_user === joao.id_user, JSON.stringify(r.body));
    const joaoDepois = (await pool.query(`SELECT senha, academy_onboarding_state FROM tb_user WHERE id_user = $1`, [joao.id_user])).rows[0];
    check("vincular: senha e estado intocados", joaoDepois.senha === joao.senha && joaoDepois.academy_onboarding_state === null);
    r = await call("POST", `/partner/v1/members/${joao.id_user}/link`, { token: keyA });
    check("link: conta comum → 409 ja_aceito", r.status === 409 && r.body.erro === "ja_aceito");

    // ─── Escopo por academia ───────────────────────────────────────────────
    r = await call("GET", `/partner/v1/members/${maria.id_user}`, { token: keyB });
    check("escopo: chave de outra academia não vê o membro (404)", r.status === 404 && r.body.erro === "nao_encontrado");
    r = await call("POST", `/partner/v1/members/${maria.id_user}/link`, { token: keyB });
    check("escopo: outra academia não gera link (404)", r.status === 404);
    r = await call("GET", "/partner/v1/members", { token: keyB });
    check("escopo: listagem da outra academia vazia", r.status === 200 && r.body.itens.length === 0);

    // ─── GET /members/:id e listagem ───────────────────────────────────────
    r = await call("GET", `/partner/v1/members/${maria.id_user}`, { token: keyA });
    check(
      "get: item no formato do contrato",
      r.status === 200 && r.body.id_user === maria.id_user && r.body.cpf === cpfMaria && r.body.ref_externa === "pessoa-123" &&
        r.body.estado === "aguardando_aceite" && r.body.avatar_url === null && r.body.treino === null,
      JSON.stringify(r.body)
    );
    r = await call("GET", "/partner/v1/members?limit=1", { token: keyA });
    check("lista: limit=1 devolve 1 item + cursor", r.status === 200 && r.body.itens.length === 1 && typeof r.body.proximo_cursor === "string");
    const seen = new Set(r.body.itens.map((i) => i.id_user));
    let cursor = r.body.proximo_cursor;
    let pages = 1;
    while (cursor && pages < 10) {
      const nx = await call("GET", `/partner/v1/members?limit=1&cursor=${encodeURIComponent(cursor)}`, { token: keyA });
      nx.body.itens.forEach((i) => seen.add(i.id_user));
      cursor = nx.body.proximo_cursor;
      pages++;
    }
    check("lista: paginação percorre os 3 vínculos sem repetir", seen.size === 3 && pages === 3, `${seen.size}/${pages}`);
    r = await call("GET", "/partner/v1/members?cursor=lixo", { token: keyA });
    check("lista: cursor inválido → 400", r.status === 400 && r.body.erro === "cursor_invalido");

    // ─── Foto da academia ──────────────────────────────────────────────────
    const fd = new FormData();
    fd.append("foto", new Blob([Buffer.from("fake-jpeg")], { type: "image/jpeg" }), "foto.jpg");
    let res = await fetch(`${base}/partner/v1/members/${maria.id_user}/foto-academia`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${keyA}` },
      body: fd,
    });
    check("foto: PUT → 200 ok", res.status === 200 && (await res.json()).ok === true);
    const photoRow = await pool.query(`SELECT * FROM tb_academy_member_photo WHERE id_user = $1`, [maria.id_user]);
    check("foto: guardada separada do avatar", photoRow.rowCount === 1 && /^academy-photos\//.test(photoRow.rows[0].photo_key));
    const avatarAntes = (await pool.query(`SELECT avatar FROM tb_user WHERE id_user = $1`, [maria.id_user])).rows[0].avatar;
    check("foto: avatar continua vazio antes do aceite", avatarAntes === null);
    const fd2 = new FormData();
    fd2.append("foto", new Blob([Buffer.from("gif")], { type: "image/gif" }), "f.gif");
    res = await fetch(`${base}/partner/v1/members/${maria.id_user}/foto-academia`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${keyA}` },
      body: fd2,
    });
    check("foto: GIF recusado (415)", res.status === 415);

    // ─── Link de primeiro acesso ───────────────────────────────────────────
    const tokenOf = (link) => new URL(link).searchParams.get("token");
    const token1 = tokenOf(maria.link_primeiro_acesso);
    r = await call("GET", `/auth/primeiro-acesso/${token1}`);
    check("1º acesso: GET info do link válido", r.status === 200 && r.body.valido === true && r.body.nome === "Maria" && r.body.academia?.slug === academyA.slug, JSON.stringify(r.body));
    r = await call("POST", `/partner/v1/members/${maria.id_user}/link`, { token: keyA });
    check("link: regenera → 200 com link novo", r.status === 200 && r.body.link_primeiro_acesso && r.body.link_primeiro_acesso !== maria.link_primeiro_acesso);
    const token2 = tokenOf(r.body.link_primeiro_acesso);
    r = await call("GET", `/auth/primeiro-acesso/${token1}`);
    check("link: o anterior deixa de valer", r.body.valido === false);
    r = await call("POST", `/partner/v1/members/00000000-0000-0000-0000-000000000000/link`, { token: keyA });
    check("link: usuário não vinculado → 404", r.status === 404 && r.body.erro === "nao_encontrado");

    r = await call("POST", "/auth/primeiro-acesso", { body: { token: token2, senha: "fraca" } });
    check("1º acesso: senha fraca recusada", r.status === 400 && r.body.reason === "senha_fraca");
    r = await call("POST", "/auth/primeiro-acesso", { body: { token: token1, senha: "Senha@123" } });
    check("1º acesso: token antigo (invalidado) recusado", r.status === 400);
    r = await call("POST", "/auth/primeiro-acesso", { body: { token: token2, senha: "Senha@123" } });
    const sess = r.body;
    check("1º acesso: cria senha e devolve sessão", r.status === 200 && typeof sess.token === "string" && sess.user?.academy_onboarding_state === "aguardando_aceite" && sess.email_verified === true && sess.needs_terms === false, JSON.stringify(r.body).slice(0, 300));
    const dec = jwt.verify(sess.token, process.env.JWT_SECRET);
    check("1º acesso: JWT da própria conta", dec.id_user === maria.id_user);
    r = await call("POST", "/auth/primeiro-acesso", { body: { token: token2, senha: "Senha@123" } });
    check("1º acesso: token usado → 400 token_usado", r.status === 400 && r.body.reason === "token_usado");
    r = await call("POST", `/partner/v1/members/${maria.id_user}/link`, { token: keyA });
    check("link: depois de criar a senha → 409 ja_aceito", r.status === 409 && r.body.erro === "ja_aceito");

    r = await call("POST", "/auth/signin", { body: { email: adulto.email, senha: "Senha@123" } });
    check("signin: entra com a senha nova, sem /aceitar-termos", r.status === 200 && r.body.needs_terms === false && r.body.user.academy_onboarding_state === "aguardando_aceite");

    // Token expirado.
    const cpfExp = cpfValido();
    r = await call("POST", "/partner/v1/members", { token: keyA, body: { cpf: cpfExp, nome: "Expira Logo", email: `exp${uid()}@t.test`, data_nascimento: "1990-01-01" } });
    const tokenExp = tokenOf(r.body.link_primeiro_acesso);
    await pool.query(`UPDATE tb_user_first_access SET expira_em = NOW() - INTERVAL '1 minute' WHERE id_user = $1`, [r.body.id_user]);
    const rInfo = await call("GET", `/auth/primeiro-acesso/${tokenExp}`);
    r = await call("POST", "/auth/primeiro-acesso", { body: { token: tokenExp, senha: "Senha@123" } });
    check("1º acesso: token expirado recusado", r.status === 400 && rInfo.body.valido === false);

    // ─── Invisível até aceitar ─────────────────────────────────────────────
    const handle = (await pool.query(`SELECT username FROM tb_user WHERE id_user = $1`, [maria.id_user])).rows[0].username;
    r = await call("GET", `/public/users/${handle}/account-summary`);
    check("visibilidade: perfil público some enquanto aguarda aceite", r.status === 404);
    r = await call("GET", `/users/${maria.id_user}`);
    check("visibilidade: /users/:id some enquanto aguarda aceite", r.status === 404);
    // As consultas públicas tocadas rodam sem erro de SQL e não trazem a conta.
    const SearchStorage = require("../src/storages/SearchStorage");
    const RankingStorage = require("../src/storages/RankingStorage");
    await pool.query(`UPDATE tb_user SET ativo = TRUE WHERE id_user = $1`, [maria.id_user]);
    let sErr = null;
    let found = null;
    try {
      const sr = await SearchStorage.searchCreators(pool, { q: "Maria" });
      const list = Array.isArray(sr) ? sr : sr?.rows || sr?.items || [];
      found = list.some((x) => x.id_user === maria.id_user);
    } catch (e) {
      sErr = e;
    }
    check("visibilidade: vitrine (searchCreators) roda e não traz a conta", !sErr && found === false, sErr?.message);
    let rErr = null;
    try {
      await RankingStorage.runRecalcPasses(pool, { season_started_at: new Date(Date.now() - 864e5), season_number: 1 });
      await RankingStorage.getTopGeneral(pool, { limit: 50 });
      await RankingStorage.getAdminRankings(pool, { limit: 5 });
    } catch (e) {
      rErr = e;
    }
    const inRank = await pool.query(
      `SELECT 1 FROM profile_ranking pr JOIN tb_profile p ON p.id_profile = pr.id_profile WHERE p.id_user = $1`,
      [maria.id_user]
    ).catch(() => ({ rowCount: -1 }));
    check("visibilidade: ranking recalcula sem a conta pendente", !rErr && inRank.rowCount === 0, rErr?.message || String(inRank.rowCount));
    r = await call("GET", `/academies/${academyA.id_academy}/ranking`);
    const rankIds = JSON.stringify(r.body || {});
    check("visibilidade: ranking público da academia sem a conta pendente", r.status === 200 && !rankIds.includes(maria.id_user), String(r.status));
    await pool.query(`UPDATE tb_user SET ativo = TRUE WHERE id_user = $1`, [maria.id_user]);

    // ─── Aceite ────────────────────────────────────────────────────────────
    const tMaria = sess.token;
    r = await call("GET", "/academy-onboarding", { token: tMaria });
    check("aceite: estado + academia + tem_foto", r.status === 200 && r.body.estado === "aguardando_aceite" && r.body.academia?.nome === "Academia Teste" && r.body.tem_foto === true, JSON.stringify(r.body));
    res = await fetch(`${base}/academy-onboarding/foto`, { headers: { Authorization: `Bearer ${tMaria}` } });
    check("aceite: foto da academia servida autenticada", res.status === 200 && (await res.text()) === "fake-jpeg");
    r = await call("POST", "/academy-onboarding/aceite", { token: tMaria, body: { foto: true } });
    check("aceite: 200 ativa + avatar", r.status === 200 && r.body.estado === "ativa" && /avatars\//.test(r.body.avatar_url || ""), JSON.stringify(r.body));
    const ua = (await pool.query(`SELECT avatar, academy_onboarding_state FROM tb_user WHERE id_user = $1`, [maria.id_user])).rows[0];
    check("aceite: estado ativa + avatar espelhado no tb_user", ua.academy_onboarding_state === "ativa" && /avatars\//.test(ua.avatar || ""));
    const cons = await pool.query(`SELECT * FROM tb_user_consent WHERE id_user = $1`, [maria.id_user]);
    check("aceite: tb_user_consent com versão e foto", cons.rowCount === 1 && cons.rows[0].versao_termos === "2026-10-20" && cons.rows[0].foto_academia_aceita === true);
    const sc = await pool.query(`SELECT terms_version FROM tb_user_action_consent WHERE id_user = $1 AND action_key = 'signup'`, [maria.id_user]);
    check("aceite: vale como aceite do cadastro", sc.rowCount === 1);
    r = await call("POST", "/academy-onboarding/aceite", { token: tMaria, body: { foto: false } });
    check("aceite: repetir → 409", r.status === 409);
    r = await call("POST", "/academy-onboarding/recusa", { token: tMaria });
    check("recusa: conta já aceita NÃO é apagada (409)", r.status === 409);
    r = await call("GET", `/partner/v1/members/${maria.id_user}`, { token: keyA });
    check("aceite: parceiro vê ativa + avatar", r.body.estado === "ativa" && /avatars\//.test(r.body.avatar_url || ""));
    r = await call("GET", `/public/users/${handle}/account-summary`);
    check("visibilidade: perfil público volta depois do aceite", r.status === 200, String(r.status));

    // ─── Recusa ────────────────────────────────────────────────────────────
    const cpfRec = cpfValido();
    r = await call("POST", "/partner/v1/members", { token: keyA, body: { cpf: cpfRec, nome: "Recusa Termos", email: `rec${uid()}@t.test`, data_nascimento: "1991-01-01" } });
    const rec = r.body;
    r = await call("POST", "/auth/primeiro-acesso", { body: { token: tokenOf(rec.link_primeiro_acesso), senha: "Senha@123" } });
    r = await call("POST", "/academy-onboarding/recusa", { token: r.body.token });
    check("recusa: 200 apagada", r.status === 200 && r.body.apagada === true, JSON.stringify(r.body));
    const gone = await pool.query(`SELECT 1 FROM tb_user WHERE id_user = $1`, [rec.id_user]);
    const goneM = await pool.query(`SELECT 1 FROM tb_academy_member WHERE id_user = $1`, [rec.id_user]);
    check("recusa: conta e vínculo apagados", gone.rowCount === 0 && goneM.rowCount === 0);
    r = await call("GET", `/partner/v1/members/${rec.id_user}`, { token: keyA });
    check("recusa: some da API do parceiro", r.status === 404);

    // ─── Treinos: validade ─────────────────────────────────────────────────
    const ex = (await pool.query(`SELECT id_exercise FROM tb_exercise ORDER BY nome LIMIT 1`)).rows[0];
    const exs = [{ id_exercise: ex.id_exercise, sets: 3, reps: "10" }];
    r = await call("POST", "/workouts/plans", { token: tMaria, body: { nome: "Treino A", exercises: exs } });
    check("treino: criar sem validade → 60", r.status === 201 && r.body.plan.validade_dias === 60 && !!r.body.plan.vence_em, JSON.stringify(r.body).slice(0, 200));
    const planA = r.body.plan;
    r = await call("POST", "/workouts/plans", { token: tMaria, body: { nome: "Treino B", exercises: exs, validade_dias: 45 } });
    check("treino: validade 45 recusada", r.status === 400);
    r = await call("POST", "/workouts/plans", { token: tMaria, body: { nome: "Treino C", exercises: exs, validade_dias: "30" } });
    check("treino: validade 30 aceita", r.status === 201 && r.body.plan.validade_dias === 30);
    r = await call("PATCH", `/workouts/plans/${planA.id_plan}`, { token: tMaria, body: { validade_dias: 90 } });
    check("treino: editar validade para 90", r.status === 200 && r.body.plan.validade_dias === 90);
    r = await call("PATCH", `/workouts/plans/${planA.id_plan}`, { token: tMaria, body: { nome: "Treino A2" } });
    check("treino: editar sem validade não mexe nela", r.status === 200 && r.body.plan.validade_dias === 90);

    // Proposta do professor (dono) com validade.
    r = await call("POST", `/academies/${academyA.id_academy}/members/${mm.id_member}/proposals`, {
      token: tOwner,
      body: { kind: "plan_create", nome: "Do Professor", exercises: exs, validade_dias: 30 },
    });
    check("proposta: plan_create com validade 30", r.status === 201 && r.body.proposal?.payload?.validade_dias === 30, JSON.stringify(r.body).slice(0, 200));
    const idProp = r.body.proposal.id_proposal;
    r = await call("POST", `/academies/${academyA.id_academy}/members/${mm.id_member}/proposals`, {
      token: tOwner,
      body: { kind: "plan_create", nome: "Inválida", exercises: exs, validade_dias: 7 },
    });
    check("proposta: validade fora da lista recusada", r.status === 400);
    r = await call("POST", "/fitness/proposals/resolve", { token: tMaria, body: { action: "accept", ids: [idProp] } });
    const prof = await pool.query(`SELECT validade_dias, created_at FROM tb_workout_plan WHERE id_user = $1 AND nome = 'Do Professor'`, [maria.id_user]);
    check("proposta: aceite cria a ficha com 30 dias", r.status === 200 && prof.rows[0]?.validade_dias === 30);

    // Parceiro vê o treino ativo mais recente com vence_em.
    r = await call("GET", `/partner/v1/members/${maria.id_user}`, { token: keyA });
    const t = r.body.treino;
    const esperado = new Date(new Date(prof.rows[0].created_at).getTime() + 30 * 864e5).toISOString();
    check("parceiro: treino = ficha ativa mais recente com vence_em", t && t.nome === "Do Professor" && t.validade_dias === 30 && t.vence_em === esperado, JSON.stringify(t));

    // Vencidas: ficha de 30 dias criada há 31 vence; a de 90 criada há 31 não.
    await pool.query(`UPDATE tb_workout_plan SET is_active = FALSE WHERE id_user = $1`, [maria.id_user]);
    await pool.query(
      `INSERT INTO tb_workout_plan (id_user, created_by, nome, validade_dias, created_at) VALUES ($1,$1,'Velha30',30, NOW() - INTERVAL '31 days')`,
      [maria.id_user]
    );
    r = await call("GET", `/academies/${academyA.id_academy}/expired-plans`, { token: tOwner });
    const venc = (r.body.members || []).find((m) => m.id_user === maria.id_user);
    check("vencidas: 30 dias criada há 31 aparece, com validade e vence_em", r.status === 200 && venc && venc.validade_dias === 30 && !!venc.vence_em && r.body.days === undefined, JSON.stringify(r.body).slice(0, 300));
    await pool.query(`UPDATE tb_workout_plan SET validade_dias = 90 WHERE id_user = $1 AND nome = 'Velha30'`, [maria.id_user]);
    r = await call("GET", `/academies/${academyA.id_academy}/expired-plans`, { token: tOwner });
    check("vencidas: a mesma com 90 dias não aparece", !(r.body.members || []).some((m) => m.id_user === maria.id_user));
  } finally {
    server.close();
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
