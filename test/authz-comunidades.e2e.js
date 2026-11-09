// test/authz-comunidades.e2e.js — Segurança A1, lote 3 (comunidades/plataformas).
//
//   npm run test:authz:comunidades   (ou `npm run test:authz`, que roda os lotes)
//
// Pergunta por rota: se a conta B trocar o id da URL pelo da comunidade da A,
// o servidor recusa? E o que é de dentro (privada, condomínio, bairro) fica lá
// dentro para quem é de fora?
// Tudo pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
//
// Seções:
//   0. anônimo → 401 nas rotas de comunidade/condomínio/espaços/academia;
//   1. comunidade da A: B não edita nome, tema, privacidade, foto, meta,
//      avisos, recado nem post do mural, não vê mensalidades nem indicadores;
//   2. comunidade privada: B (de fora) não lê mural, bees, membros nem avisos,
//      e o "Entrar" pede pagamento em vez de colocá-lo dentro;
//   3. bairro (A1-11, A1-09): o "Entrar" genérico não põe forasteiro no bairro
//      (só morador reconhecido entra) e o mural de bees do bairro não abre para
//      quem é de fora;
//   4. condomínio da A: B não lê avisos, enquetes, moradores, disputas nem
//      mexe na planta/estrutura;
//   5. pet da A: B não edita nem apaga;
//   6. rotas de admin do lote recusam usuário comum (403).
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
const tag = uid();

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

// CEP falso, bairro com nome único: o território do teste nunca colide com o
// de outra suíte (uma comunidade por bairro).
const CEP = "01310100";
const BAIRRO = `Bairro Authz ${tag}`;
const viacep = require("../src/integrations/viacep/lookup");
viacep.lookupZipcode = async (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  if (d !== CEP) return null;
  return { cep: CEP, logradouro: "Rua Authz", bairro: BAIRRO, localidade: "São Paulo", uf: "SP" };
};

const pool = require("../src/databases");
const app = require("../src/app");
const CommunityStorage = require("../src/storages/CommunityStorage");
const ResidenceService = require("../src/services/ResidenceService");
const NeighborhoodService = require("../src/services/NeighborhoodService");
const FeatureFlagService = require("../src/services/FeatureFlagService");

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

async function createUser(nome) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email`,
    [nome, `authzc${uid()}`, `authzc${uid()}@t.test`]
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

async function mkCommunity(owner, { kind, privacy, name }) {
  const { rows } = await pool.query(`SELECT id_machine FROM tb_machine ORDER BY id_machine LIMIT 1`);
  const community = await CommunityStorage.createCommunity(pool, {
    id_user: owner,
    id_machine: rows[0].id_machine,
    display_name: name,
    bio: null,
    avatar_url: null,
    theme: null,
    kind,
    address: {
      street: "Rua Teste", number: "1", complement: null, neighborhood: "Centro",
      cep: "01310100", estado: "SP", municipio: "Sao Paulo",
    },
  });
  if (privacy === "private") {
    await CommunityStorage.setPrivacy(pool, community.id_profile, { privacy: "private", monthly_cents: 1000 });
  }
  await CommunityStorage.addMember(pool, community.id_profile, owner, "leader");
  return community.id_profile;
}

async function mkBee(u, caption, id_community) {
  const r = await pool.query(
    `INSERT INTO tb_story (id_profile, id_user, kind, video_url, duration_seconds, expires_at, caption, id_community)
     VALUES ($1,$2,'bee','https://r2.test/b.mp4',10, NOW() + INTERVAL '1 day', $3, $4)
     RETURNING id_story`,
    [u.id_profile, u.id_user, caption, id_community]
  );
  return r.rows[0].id_story;
}

const FLAGS = ["condominio", "bairro", "pet", "carro", "comunidade_privada", "fitness_academias"];

(async () => {
  const A = await createUser("Conta A");
  const B = await createUser("Conta B");
  const R = await createUser("Conta R"); // moradora reconhecida do bairro da A
  const users = [A.id_user, B.id_user, R.id_user];
  const tA = tokenOf(A);
  const tB = tokenOf(B);
  const tR = tokenOf(R);
  const communities = [];

  // As portas ficam atrás de flags: com elas desligadas toda recusa viria do
  // 403 da flag e o teste não provaria nada. Liga e devolve como estava.
  const prevFlags = (
    await pool.query(`SELECT flag_key, is_enabled FROM tb_feature_flag WHERE flag_key = ANY($1)`, [FLAGS])
  ).rows;
  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE WHERE flag_key = ANY($1)`, [FLAGS]);
  FeatureFlagService.invalidate?.();

  const pub = await mkCommunity(A.id_user, { kind: "common", privacy: "public", name: `Publica ${tag}` });
  const priv = await mkCommunity(A.id_user, { kind: "common", privacy: "private", name: `Privada ${tag}` });
  const condo = await mkCommunity(A.id_user, { kind: "condo", privacy: "public", name: `Condo ${tag}` });
  const pet = await mkCommunity(A.id_user, { kind: "pet", privacy: "public", name: `Rex ${tag}` });
  communities.push(pub, priv, condo, pet);

  // Bairro de verdade: A e R declaram residência no mesmo CEP (endereços
  // diferentes → os dois reconhecidos), A cria a comunidade do bairro.
  await ResidenceService.claim({ id_user: A.id_user, cep: CEP, numero: "10" });
  await ResidenceService.claim({ id_user: R.id_user, cep: CEP, numero: "20" });
  const nb = await NeighborhoodService.create({ id_user: A.id_user }, {});
  const hood = nb?.community?.id_profile;
  if (!hood) throw new Error(`bairro não foi criado: ${JSON.stringify(nb)}`);
  communities.push(hood);

  const beeHood = await mkBee(A, "bee do bairro", hood);
  const beePriv = await mkBee(A, "bee da privada", priv);

  // Mural da pública: um recado da A e um aviso fixado.
  const recado = await CommunityStorage.createRecado(pool, pub, { body: "recado da A", id_author_user: A.id_user, sport: null });
  const ann = await CommunityStorage.createAnnouncement(pool, pub, { body: "aviso", is_pinned: true, created_by_user: A.id_user });
  await CommunityStorage.createAnnouncement(pool, priv, { body: "aviso secreto", is_pinned: false, created_by_user: A.id_user });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ═══ 0. anônimo ═════════════════════════════════════════════════════
    console.log("\n━━━ 0. anônimo → 401 ━━━");
    const AUTH_ROUTES = [
      ["GET", "/communities/me"], ["POST", "/communities"], ["PATCH", `/communities/${pub}/profile`],
      ["POST", `/communities/${pub}/join`], ["GET", `/communities/${pub}/bees`], ["POST", `/communities/${pub}/recado`],
      ["GET", `/communities/${pub}/membership/summary`], ["GET", `/communities/${pub}/indicators`],
      ["GET", "/communities/votes/pending"], ["GET", "/clans/me"], ["POST", `/clans/${pub}/messages`],
      ["GET", `/condos/${condo}/notices`], ["GET", "/neighborhoods/mine"], ["POST", `/neighborhoods/${hood}/join`],
      ["GET", "/me/spaces"], ["DELETE", `/pets/${pet}`], ["GET", "/finance"], ["GET", "/me/academies"],
      ["GET", "/fitness/summary"], ["GET", "/me/platform-avatar/games"],
    ];
    for (const [m, p] of AUTH_ROUTES) {
      const r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} sem login = 401`, r.status === 401, `veio ${r.status}`);
    }

    // ═══ 1. B contra a comunidade da A ══════════════════════════════════
    console.log("\n━━━ 1. B contra a comunidade (pública) da A ━━━");
    let r;
    const WRITES = [
      ["PATCH", `/communities/${pub}/profile`, { display_name: "tomada" }],
      ["PATCH", `/communities/${pub}/theme`, { theme: { accent: "#000000" } }],
      ["PATCH", `/communities/${pub}/privacy`, { privacy: "private", monthly_cents: 99999 }],
      ["DELETE", `/communities/${pub}/avatar`],
      ["PUT", `/communities/${pub}/goal`, { title: "x", ends_at: "2099-01-01" }],
      ["DELETE", `/communities/${pub}/goal`],
      ["POST", `/communities/${pub}/announcements`, { body: "aviso falso" }],
      ["DELETE", `/communities/${pub}/announcements/${ann.id}`],
      ["DELETE", `/communities/${pub}/recado/${recado}`],
      ["GET", `/communities/${pub}/membership/summary`],
      ["GET", `/communities/${pub}/indicators`],
      ["POST", `/communities/${pub}/membership/checkout`],
    ];
    for (const [m, p, body] of WRITES) {
      r = await call(m, p, { token: tB, body: body ?? (m === "GET" ? undefined : {}) });
      const okRefusal = r.status >= 400 || (p.endsWith("/membership/checkout") && r.status >= 400);
      check(`B: ${m} ${p.replace(pub, ":id").replace(/[0-9a-f-]{36}/g, ":x")} recusado`, okRefusal, `veio ${r.status}`);
    }
    const row = await pool.query(
      `SELECT display_name, community_privacy FROM tb_profile WHERE id_profile=$1`, [pub]
    );
    check("banco: nome e privacidade da comunidade intactos",
      row.rows[0].display_name === `Publica ${tag}` && (row.rows[0].community_privacy || "public") === "public",
      JSON.stringify(row.rows[0]));
    const annLeft = await pool.query(`SELECT count(*)::int n FROM tb_community_announcement WHERE id_community_profile=$1`, [pub]);
    check("banco: aviso da A segue lá e B não criou aviso", annLeft.rows[0].n === 1, `n=${annLeft.rows[0].n}`);
    const recLeft = await pool.query(`SELECT count(*)::int n FROM tb_community_feed_item WHERE id=$1`, [recado]);
    check("banco: recado da A não foi apagado", recLeft.rows[0].n === 1, `n=${recLeft.rows[0].n}`);
    r = await call("POST", `/communities/${pub}/recado`, { token: tB, body: { body: "recado de quem não é membro" } });
    check("B (não membro) não publica recado na comunidade", r.status >= 400, `veio ${r.status}`);

    // ═══ 2. privada ═════════════════════════════════════════════════════
    console.log("\n━━━ 2. comunidade privada da A, vista por B ━━━");
    r = await call("POST", `/communities/${priv}/join`, { token: tB });
    check("Entrar na privada pede pagamento", r.body?.requires_payment === true, JSON.stringify(r.body));
    const mPriv = await CommunityStorage.getMembership(pool, priv, B.id_user);
    check("banco: B não virou membro da privada", !mPriv);
    r = await call("GET", `/communities/${priv}/feed-posts`, { token: tB });
    check("mural da privada trancado para B", r.body?.locked === true && (r.body?.items || []).length === 0, JSON.stringify(r.body).slice(0, 120));
    r = await call("GET", `/communities/${priv}/members`, { token: tB });
    check("lista de membros da privada recusa B", r.status === 403, `veio ${r.status}`);
    r = await call("GET", `/communities/${priv}/bees`, { token: tB });
    check("bees do mural da privada não abrem para B", !(r.body?.bees || []).some((b) => String(b.id_story) === String(beePriv)), JSON.stringify(r.body).slice(0, 120));
    r = await call("GET", `/communities/${priv}/announcements`, { token: tB });
    check("avisos da privada não saem para B", (r.body?.announcements || []).length === 0, JSON.stringify(r.body).slice(0, 120));
    r = await call("GET", `/communities/${priv}/goal`);
    check("meta da privada recusa anônimo", r.status === 403, `veio ${r.status}`);

    // ═══ 3. bairro ══════════════════════════════════════════════════════
    console.log("\n━━━ 3. bairro da A: forasteiro × morador ━━━");
    r = await call("POST", `/communities/${hood}/join`, { token: tB });
    check("A1-11: Entrar genérico recusa quem não mora no bairro", r.status >= 400, `veio ${r.status} ${JSON.stringify(r.body)}`);
    const mHood = await CommunityStorage.getMembership(pool, hood, B.id_user);
    check("banco: B não virou membro do bairro", !mHood);
    r = await call("GET", `/communities/${hood}/feed-posts`, { token: tB });
    check("mural do bairro trancado para B", r.body?.locked === true, JSON.stringify(r.body).slice(0, 120));
    r = await call("GET", `/communities/${hood}/bees`, { token: tB });
    check("A1-09: bees do mural do bairro não abrem para B",
      !(r.body?.bees || []).some((b) => String(b.id_story) === String(beeHood)), JSON.stringify(r.body).slice(0, 160));
    r = await call("POST", `/neighborhoods/${hood}/join`, { token: tB });
    check("porta própria do bairro também recusa B", r.status === 403, `veio ${r.status}`);
    r = await call("POST", `/communities/${hood}/join`, { token: tR });
    check("morador reconhecido entra pelo Entrar genérico", r.status < 400 && r.body?.ok === true, `veio ${r.status} ${JSON.stringify(r.body)}`);
    r = await call("GET", `/communities/${hood}/bees`, { token: tR });
    check("morador vê os bees do bairro", (r.body?.bees || []).some((b) => String(b.id_story) === String(beeHood)), JSON.stringify(r.body).slice(0, 160));

    // ═══ 4. condomínio ══════════════════════════════════════════════════
    console.log("\n━━━ 4. condomínio da A, visto por B ━━━");
    const CONDO = [
      ["GET", `/condos/${condo}/notices`], ["POST", `/condos/${condo}/notices`, { title: "x", body: "x" }],
      ["GET", `/condos/${condo}/polls`], ["POST", `/condos/${condo}/polls`, { question: "x", options: ["a", "b"] }],
      ["GET", `/condos/${condo}/residents`], ["GET", `/condos/${condo}/claims`], ["GET", `/condos/${condo}/structure`],
      ["PATCH", `/condos/${condo}/address`, { street: "x" }], ["POST", `/condos/${condo}/blocks`, { name: "Torre X" }],
      ["POST", `/condos/${condo}/plant/blocks`, { name: "Torre X" }], ["POST", `/condos/${condo}/plant/units`, { number: "1" }],
      ["POST", `/condos/${condo}/disputes/1/decide`, { decision: "x" }], ["GET", `/condos/${condo}/disputes/1/proof/1/url`],
      ["GET", `/condos/${condo}/listings`], ["POST", `/condos/${condo}/listings`, { title: "x" }],
    ];
    for (const [m, p, body] of CONDO) {
      r = await call(m, p, { token: tB, body: body ?? (m === "GET" ? undefined : {}) });
      check(`B: ${m} ${p.replace(condo, ":condo")} recusado`, r.status >= 400, `veio ${r.status}`);
    }
    r = await call("GET", `/communities/${condo}/members`, { token: tB });
    check("lista de moradores do condomínio recusa B", r.status === 403, `veio ${r.status}`);
    r = await call("POST", `/communities/${condo}/join`, { token: tB });
    check("Entrar genérico no condomínio é recusado (porta é a planta)", r.status === 409, `veio ${r.status}`);

    // ═══ 5. pet ═════════════════════════════════════════════════════════
    console.log("\n━━━ 5. pet da A, visto por B ━━━");
    r = await call("PATCH", `/pets/${pet}`, { token: tB, body: { name: "tomado" } });
    check("B não edita o pet da A", r.status === 403, `veio ${r.status}`);
    r = await call("DELETE", `/pets/${pet}`, { token: tB });
    check("B não apaga o pet da A", r.status === 403, `veio ${r.status}`);
    r = await call("POST", `/communities/${pet}/join`, { token: tB });
    check("ninguém vira membro do pet alheio", r.status === 409, `veio ${r.status}`);
    const petRow = await pool.query(`SELECT deleted_at FROM tb_profile WHERE id_profile=$1`, [pet]);
    check("banco: pet da A segue vivo", petRow.rows[0].deleted_at === null);

    // ═══ 6. admin ═══════════════════════════════════════════════════════
    console.log("\n━━━ 6. usuário comum em rota de admin do lote → 403 ━━━");
    const ADMIN_ROUTES = [
      ["GET", "/admin/community-commerce/settings"], ["PUT", "/admin/community-commerce/listing-settings"],
      ["GET", "/admin/community-commerce/disputes"], ["POST", "/admin/community-commerce/disputes/1/decide"],
      ["GET", "/admin/academy-payouts"], ["POST", "/admin/academy-payouts/1/paid"],
    ];
    for (const [m, p] of ADMIN_ROUTES) {
      r = await call(m, p, { token: tB, body: m === "GET" ? undefined : {} });
      check(`${m} ${p} com conta comum = 403`, r.status === 403, `veio ${r.status}`);
    }
    void tA;
  } finally {
    server.close();
    for (const f of prevFlags) {
      await pool.query(`UPDATE tb_feature_flag SET is_enabled = $2 WHERE flag_key = $1`, [f.flag_key, f.is_enabled]).catch(() => {});
    }
    await pool.query(`DELETE FROM tb_story WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM tb_profile WHERE id_profile = ANY($1::uuid[])`, [communities]).catch(() => {});
    await pool.query(`DELETE FROM tb_residence_member WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
