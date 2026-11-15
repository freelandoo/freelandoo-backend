// test/feed-interativo.e2e.js — Feed Interativo (migs 456+) ponta a ponta.
//
//   npm run test:feed-interativo
//
// Pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
// F2 (Throw): convite → aceite → lançar → inbox → visto; silêncio descarta em
// segredo; post de comunidade privada não é lançável; bloqueio social e
// política "ninguém" fecham a porta; só o dono de cada lado age no vínculo.
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

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const app = require("../src/app");
const CommunityStorage = require("../src/storages/CommunityStorage");

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

async function createUser(nome, birth = "1990-01-01") {
  const username = `fi${uid()}`;
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q',$4,TRUE)
     RETURNING id_user, email, username`,
    [nome, username, `${username}@t.test`, birth]
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

async function mkPost(id_profile, title, id_exclusive_community = null) {
  const r = await pool.query(
    `INSERT INTO tb_profile_portfolio_item (id_profile, title, id_exclusive_community)
     VALUES ($1,$2,$3) RETURNING id_portfolio_item`,
    [id_profile, title, id_exclusive_community]
  );
  const id = r.rows[0].id_portfolio_item;
  await pool.query(
    `INSERT INTO tb_profile_portfolio_media (id_portfolio_item, media_url, media_type) VALUES ($1,'https://r2.test/a.jpg','image')`,
    [id]
  );
  return id;
}

async function mkPrivateCommunity(owner, name) {
  const { rows } = await pool.query(`SELECT id_machine FROM tb_machine ORDER BY id_machine LIMIT 1`);
  const community = await CommunityStorage.createCommunity(pool, {
    id_user: owner,
    id_machine: rows[0].id_machine,
    display_name: name,
    bio: null,
    avatar_url: null,
    theme: null,
    kind: "common",
    address: { street: "Rua Teste", number: "1", complement: null, neighborhood: "Centro", cep: "01310100", estado: "SP", municipio: "Sao Paulo" },
  });
  await CommunityStorage.setPrivacy(pool, community.id_profile, { privacy: "private", monthly_cents: 1000 });
  await CommunityStorage.addMember(pool, community.id_profile, owner, "leader");
  return community.id_profile;
}

async function f2() {
  console.log("━━━ F2 · Throw ━━━");
  const A = await createUser("Lança A");
  const B = await createUser("Recebe B");
  const C = await createUser("Estranho C");
  const tA = tokenOf(A);
  const tB = tokenOf(B);
  const tC = tokenOf(C);
  const postA = await mkPost(A.id_profile, "Post do A");
  const postA2 = await mkPost(A.id_profile, "Outro post do A");
  const priv = await mkPrivateCommunity(A.id_user, `Privada ${uid()}`);
  const postX = await mkPost(A.id_profile, "Exclusivo", priv);

  check("anônimo → 401", (await call("GET", "/feed-interativo/links")).status === 401);

  const inv = await call("POST", "/feed-interativo/links", { token: tA, body: { username: `@${B.username}` } });
  check("A convida B pelo @", inv.status === 200 && inv.body?.link?.status === "pending", JSON.stringify(inv.body));
  const id_link = inv.body?.link?.id_link;
  const again = await call("POST", "/feed-interativo/links", { token: tA, body: { username: B.username } });
  check("convite repetido é idempotente", again.status === 200 && again.body?.already === true);
  check("convidar a si mesmo é recusado", (await call("POST", "/feed-interativo/links", { token: tA, body: { username: A.username } })).status === 400);
  check("@ inexistente = resposta genérica 404", (await call("POST", "/feed-interativo/links", { token: tA, body: { username: "naoexiste_zz" } })).status === 404);

  const linksB = await call("GET", "/feed-interativo/links", { token: tB });
  check("B vê o convite pendente do A", linksB.body?.receiving?.some((l) => l.id_link === id_link && l.status === "pending" && l.user.username === A.username));
  check("sem aceite, A não tem alvo", (await call("GET", "/feed-interativo/targets", { token: tA })).body?.targets?.length === 0);
  check("sem aceite, lançar é recusado", (await call("POST", "/feed-interativo/throw", { token: tA, body: { post_id: postA, to: "all" } })).status === 403);

  check("A (sender) não pode aceitar o próprio convite", (await call("POST", `/feed-interativo/links/${id_link}/accept`, { token: tA })).status === 403);
  check("C (de fora) não enxerga o vínculo", (await call("POST", `/feed-interativo/links/${id_link}/accept`, { token: tC })).status === 404);
  check("ação inventada é recusada", (await call("POST", `/feed-interativo/links/${id_link}/explodir`, { token: tB })).status === 400);
  const acc = await call("POST", `/feed-interativo/links/${id_link}/accept`, { token: tB });
  check("B aceita", acc.status === 200 && acc.body?.link?.status === "active");

  const tg = await call("GET", "/feed-interativo/targets", { token: tA });
  check("A passa a ter B como alvo", tg.body?.targets?.length === 1 && tg.body.targets[0].id_user === B.id_user);

  const th = await call("POST", "/feed-interativo/throw", { token: tA, body: { post_id: postA, to: "all" } });
  check("A lança para todos", th.status === 200 && th.body?.sent === 1, JSON.stringify(th.body));
  const inbox = await call("GET", "/feed-interativo/inbox", { token: tB });
  const it = inbox.body?.items?.[0];
  check("o post cai na inbox do B no shape do card", inbox.body?.items?.length === 1 && it?.post?.post_id === postA && it?.sender?.username === A.username && it?.kind === "throw", JSON.stringify(inbox.body));

  const dup = await call("POST", "/feed-interativo/throw", { token: tA, body: { post_id: postA, to: B.id_user } });
  check("mesmo post de novo em 24 h não duplica", dup.status === 200 && (await call("GET", "/feed-interativo/inbox", { token: tB })).body?.items?.length === 1);

  check("post exclusivo de comunidade privada não é lançável", (await call("POST", "/feed-interativo/throw", { token: tA, body: { post_id: postX, to: "all" } })).status === 403);
  check("C não lança para B (sem vínculo)", (await call("POST", "/feed-interativo/throw", { token: tC, body: { post_id: postA, to: B.id_user } })).status === 403);

  const seen = await call("POST", "/feed-interativo/seen", { token: tB, body: { ids: [it?.id_drop] } });
  check("B marca visto → inbox vazia", seen.body?.updated === 1 && (await call("GET", "/feed-interativo/inbox", { token: tB })).body?.items?.length === 0);
  const other = await call("POST", "/feed-interativo/seen", { token: tC, body: { ids: [it?.id_drop] } });
  check("C não mexe no drop do B", other.body?.updated === 0);

  // Silêncio: o A continua vendo o B ativo e "envia", mas nada chega.
  check("B silencia o A", (await call("POST", `/feed-interativo/links/${id_link}/silence`, { token: tB })).body?.link?.status === "silenced");
  const linksA = await call("GET", "/feed-interativo/links", { token: tA });
  check("para o A, o B segue 'active' (silêncio é segredo)", linksA.body?.sending?.[0]?.status === "active");
  const thM = await call("POST", "/feed-interativo/throw", { token: tA, body: { post_id: postA2, to: "all" } });
  check("lançar para silenciado responde igual (sent 1)", thM.status === 200 && thM.body?.sent === 1);
  check("…e não chega na inbox do B", (await call("GET", "/feed-interativo/inbox", { token: tB })).body?.items?.length === 0);
  const muted = await pool.query(`SELECT status FROM tb_feed_drop WHERE id_sender=$1 AND id_portfolio_item=$2`, [A.id_user, postA2]);
  check("o drop ficou 'muted'", muted.rows[0]?.status === "muted");
  await call("POST", `/feed-interativo/links/${id_link}/unsilence`, { token: tB });

  // Bloqueio social fecha tudo.
  await pool.query(`INSERT INTO tb_user_block (blocker_user_id, blocked_user_id) VALUES ($1,$2)`, [B.id_user, A.id_user]);
  check("com bloqueio social, A fica sem alvo", (await call("GET", "/feed-interativo/targets", { token: tA })).body?.targets?.length === 0);
  await pool.query(`DELETE FROM tb_user_block WHERE blocker_user_id=$1 AND blocked_user_id=$2`, [B.id_user, A.id_user]);

  // Política "ninguém".
  const pr = await call("PUT", "/feed-interativo/prefs", { token: tC, body: { invite_policy: "ninguem" } });
  check("C fecha convites", pr.body?.invite_policy === "ninguem");
  check("convite para C é recusado", (await call("POST", "/feed-interativo/links", { token: tA, body: { username: C.username } })).status === 403);
  check("política inventada é recusada", (await call("PUT", "/feed-interativo/prefs", { token: tC, body: { invite_policy: "x" } })).status === 400);

  // Revogar + reconvite precisa esperar.
  check("B revoga", (await call("POST", `/feed-interativo/links/${id_link}/revoke`, { token: tB })).body?.link?.status === "revoked");
  check("reconvite logo depois → 429", (await call("POST", "/feed-interativo/links", { token: tA, body: { username: B.username } })).status === 429);
  check("B bloqueia o A no vínculo", (await call("POST", `/feed-interativo/links/${id_link}/block`, { token: tB })).body?.link?.status === "blocked");
  check("bloqueado → convite genérico 404", (await call("POST", "/feed-interativo/links", { token: tA, body: { username: B.username } })).status === 404);

  // Menor não entra.
  const kid = await createUser("Menor K", "2015-01-01");
  await pool.query(`UPDATE tb_user SET is_minor = TRUE WHERE id_user = $1`, [kid.id_user]);
  const kidInv = await call("POST", "/feed-interativo/links", { token: tA, body: { username: kid.username } });
  check("convite para conta de menor é recusado", kidInv.status === 403, JSON.stringify(kidInv.body));

  return { A, B, C, tA, tB, tC, postA, id_link };
}

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ctx = await f2();
    for (const extra of module.exports.phases) await extra(ctx);
  } catch (err) {
    FAIL++;
    console.error("  ✗ exceção:", err);
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }
  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})();

// As fases seguintes (baú, cápsula, Paths, Sync) se registram aqui.
module.exports.phases = [];
module.exports.helpers = { call, check, createUser, tokenOf, mkPost, pool };
