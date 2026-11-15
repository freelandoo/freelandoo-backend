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
  module.exports.server = server;
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

// ── F3 · Baú ────────────────────────────────────────────────────────────────
async function linkPair(S, R) {
  const inv = await call("POST", "/feed-interativo/links", { token: tokenOf(S), body: { username: R.username } });
  await call("POST", `/feed-interativo/links/${inv.body.link.id_link}/accept`, { token: tokenOf(R) });
  return inv.body.link.id_link;
}

async function f3() {
  console.log("━━━ F3 · Baú ━━━");
  const S = await createUser("Manda S");
  const R = await createUser("Recebe R");
  const Q = await createUser("Recebe Q");
  const tS = tokenOf(S);
  const tR = tokenOf(R);
  const tQ = tokenOf(Q);
  check("sem vínculo, baú é recusado", (await call("POST", "/feed-interativo/gift", { token: tS, body: { to: R.id_user, sticker: "coroa" } })).status === 403);
  await linkPair(S, R);
  await linkPair(S, Q);
  check("baú vazio é recusado", (await call("POST", "/feed-interativo/gift", { token: tS, body: { to: R.id_user } })).status === 400);
  check("figurinha inventada é recusada", (await call("POST", "/feed-interativo/gift", { token: tS, body: { to: R.id_user, sticker: "dinheiro" } })).status === 400);

  const g = await call("POST", "/feed-interativo/gift", {
    token: tS,
    body: { to: R.id_user, chest: "ouro", sticker: "gema", reaction: "confete", message: "  oi\u0007 R\n\n\n\nbeijo  " },
  });
  check("S manda baú para R", g.status === 200 && g.body?.sent === 1, JSON.stringify(g.body));
  const inbox = await call("GET", "/feed-interativo/inbox", { token: tR });
  const gift = inbox.body?.items?.find((x) => x.kind === "gift");
  check("baú chega fechado (sem revelar o conteúdo)", gift && gift.post === null && gift.payload?.chest === "ouro" && gift.payload.sticker === undefined && gift.payload.message === undefined, JSON.stringify(gift));
  await call("POST", "/feed-interativo/seen", { token: tR, body: { ids: [gift?.id_drop] } });
  check("visto não tira o baú da fila (só abrir tira)", (await call("GET", "/feed-interativo/inbox", { token: tR })).body?.items?.some((x) => x.id_drop === gift?.id_drop));
  check("Q não abre o baú do R", (await call("POST", `/feed-interativo/drops/${gift?.id_drop}/open`, { token: tQ })).status === 404);
  const op = await call("POST", `/feed-interativo/drops/${gift?.id_drop}/open`, { token: tR });
  check("R abre: figurinha, raridade, reação e mensagem limpa", op.status === 200 && op.body?.gift?.sticker === "gema" && op.body.gift.rarity === "lendario" && op.body.gift.reaction === "confete" && op.body.gift.message === "oi R\n\nbeijo", JSON.stringify(op.body));
  check("abrir de novo → 409", (await call("POST", `/feed-interativo/drops/${gift?.id_drop}/open`, { token: tR })).status === 409);
  const st = await call("GET", "/feed-interativo/stickers", { token: tR });
  check("a figurinha entra na coleção (1×)", st.body?.stickers?.length === 1 && st.body.stickers[0].sticker_id === "gema" && st.body.stickers[0].qty === 1);
  check("aberto sai da fila", !(await call("GET", "/feed-interativo/inbox", { token: tR })).body?.items?.some((x) => x.id_drop === gift?.id_drop));

  // limite por par: 2 por dia
  await call("POST", "/feed-interativo/gift", { token: tS, body: { to: R.id_user, sticker: "raio" } });
  check("3º baú para o mesmo par no dia → 429", (await call("POST", "/feed-interativo/gift", { token: tS, body: { to: R.id_user, sticker: "raio" } })).status === 429);

  // na sorte: R está no limite, então a sorte só pode cair no Q
  const lucky = await call("POST", "/feed-interativo/gift", { token: tS, body: { to: "sorte", reaction: "fogos" } });
  check("na sorte cai em quem ainda cabe (Q)", lucky.status === 200 && lucky.body?.to?.id_user === Q.id_user, JSON.stringify(lucky.body));

  // quem não aceita presentes
  await call("PUT", "/feed-interativo/prefs", { token: tQ, body: { accept_gifts: false } });
  check("Q fecha presentes → baú direto recusado", (await call("POST", "/feed-interativo/gift", { token: tS, body: { to: Q.id_user, sticker: "sol" } })).status === 403);
}
module.exports.phases.push(f3);

// ── F4 · Cápsula do tempo ──────────────────────────────────────────────────
async function f4() {
  console.log("━━━ F4 · Cápsula do tempo ━━━");
  const FeedInterativoService = require("../src/services/FeedInterativoService");
  const S = await createUser("Escreve S");
  const R = await createUser("Lê R");
  const tS = tokenOf(S);
  const tR = tokenOf(R);
  const inTwo = () => new Date(Date.now() + 2 * 60_000).toISOString();
  const due = (id) => pool.query(`UPDATE tb_feed_drop SET deliver_at = NOW() - INTERVAL '1 second' WHERE id_drop = $1`, [id]);

  check("cápsula para quem não aceitou → 403", (await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: R.id_user, deliver_at: inTwo(), message: "oi" } })).status === 403);
  check("entrega daqui a 30 s → 400", (await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: "eu", deliver_at: new Date(Date.now() + 30_000).toISOString(), message: "oi" } })).status === 400);
  check("entrega daqui a 6 anos → 400", (await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: "eu", deliver_at: new Date(Date.now() + 6 * 366 * 86400_000).toISOString(), message: "oi" } })).status === 400);
  check("cápsula vazia → 400", (await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: "eu", deliver_at: inTwo() } })).status === 400);

  const self = await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: "eu", deliver_at: inTwo(), message: "carta para o futuro" } });
  check("S agenda uma carta para si mesmo", self.status === 200 && self.body?.capsule?.status === "scheduled", JSON.stringify(self.body));
  const idSelf = self.body?.capsule?.id_drop;
  check("antes da hora, a inbox está vazia", (await call("GET", "/feed-interativo/inbox", { token: tS })).body?.items?.length === 0);
  await due(idSelf);
  const n = await FeedInterativoService.deliverDueCapsules();
  check("o worker entrega o que venceu", n >= 1);
  const inb = await call("GET", "/feed-interativo/inbox", { token: tS });
  const cap = inb.body?.items?.find((x) => x.id_drop === idSelf);
  check("a cápsula chega com a mensagem e as datas", cap?.kind === "capsule" && cap.payload?.message === "carta para o futuro" && !!cap.payload?.written_at, JSON.stringify(inb.body));
  check("o worker não entrega duas vezes", (await FeedInterativoService.deliverDueCapsules()) === 0);

  await linkPair(S, R);
  const c2 = await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: R.id_user, deliver_at: inTwo(), message: "pra você" } });
  const idC2 = c2.body?.capsule?.id_drop;
  check("R não cancela a cápsula do S", (await call("POST", `/feed-interativo/capsules/${idC2}/cancel`, { token: tR })).status === 409);
  check("S cancela antes da hora", (await call("POST", `/feed-interativo/capsules/${idC2}/cancel`, { token: tS })).body?.ok === true);
  await due(idC2);
  await FeedInterativoService.deliverDueCapsules();
  check("cancelada não é entregue", !(await call("GET", "/feed-interativo/inbox", { token: tR })).body?.items?.some((x) => x.id_drop === idC2));

  // vínculo revogado ANTES da hora: falha na entrega
  const c3 = await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: R.id_user, deliver_at: inTwo(), message: "tarde demais" } });
  const links = await call("GET", "/feed-interativo/links", { token: tR });
  const lid = links.body?.receiving?.find((l) => l.user.id_user === S.id_user)?.id_link;
  await call("POST", `/feed-interativo/links/${lid}/revoke`, { token: tR });
  await due(c3.body?.capsule?.id_drop);
  await FeedInterativoService.deliverDueCapsules();
  const st3 = await pool.query(`SELECT status FROM tb_feed_drop WHERE id_drop = $1`, [c3.body?.capsule?.id_drop]);
  check("permissão retirada antes da hora → failed", st3.rows[0]?.status === "failed");

  // destino "mensagens": vira mensagem direta e não entra no feed
  const M = await createUser("Mensagem M");
  await linkPair(S, M);
  const c4 = await call("POST", "/feed-interativo/capsules", { token: tS, body: { to: M.id_user, deliver_at: inTwo(), message: "chegou pelo chat", destino: "mensagens" } });
  await due(c4.body?.capsule?.id_drop);
  await FeedInterativoService.deliverDueCapsules();
  const st4 = await pool.query(`SELECT status FROM tb_feed_drop WHERE id_drop = $1`, [c4.body?.capsule?.id_drop]);
  const msg = await pool.query(`SELECT body FROM tb_message WHERE client_message_id = $1`, [c4.body?.capsule?.id_drop]).catch((e) => ({ rows: [], err: e.message }));
  check("destino mensagens: mensagem direta criada e fora do feed", st4.rows[0]?.status === "seen" && msg.rows[0]?.body?.includes("chegou pelo chat"), JSON.stringify({ st: st4.rows[0], msg: msg.rows[0] || msg.err }));

  const list = await call("GET", "/feed-interativo/capsules", { token: tS });
  check("S vê a lista das cápsulas com o estado", list.body?.capsules?.length === 4 && list.body.capsules.some((c) => c.status === "canceled"));
}
module.exports.phases.push(f4);

// ── F5 · Paths ─────────────────────────────────────────────────────────────
async function f5() {
  console.log("━━━ F5 · Paths ━━━");
  const AU = await createUser("Autor P");
  const V = await createUser("Leitor V");
  const tAU = tokenOf(AU);
  const tV = tokenOf(V);
  const carrier = await mkPost(AU.id_profile, "Post que carrega");
  const scene = await mkPost(AU.id_profile, "Cena com mídia");
  const notMine = await mkPost(V.id_profile, "Post do leitor");

  check("anônimo não cria história", (await call("POST", "/paths", { body: { title: "x" } })).status === 401);
  const cr = await call("POST", "/paths", { token: tAU, body: { title: "A casa" } });
  const id = cr.body?.story?.id_story;
  check("autor cria a história (nasce com o começo)", cr.status === 200 && cr.body.story.nodes.length === 1 && cr.body.story.root === cr.body.story.nodes[0].id, JSON.stringify(cr.body));
  check("outro não abre o rascunho", (await call("GET", `/paths/${id}`, { token: tV })).status === 404);

  const root = cr.body.story.root;
  const graph = {
    title: "A casa",
    root,
    nodes: [
      { id: root, title: "A porta", body: "Uma porta rangendo.", media_post_id: scene, choices: [{ id: "c:abrir", label: "Abrir a porta", target: "n:dentro" }, { id: "c:fugir", label: "Fugir", target: "n:fuga" }] },
      { id: "n:dentro", title: "Lá dentro", body: "Escuro.", media_post_id: notMine, is_ending: true },
      { id: "n:fuga", title: "Fugiu", body: "Salvo.", is_ending: true, choices: [{ label: "ignorado", target: root }] },
    ],
  };
  const sv = await call("PUT", `/paths/${id}`, { token: tAU, body: graph });
  const g = sv.body?.story;
  check("salva o grafo (ids novos viram uuid)", sv.status === 200 && g.nodes.length === 3 && g.nodes.every((n) => /^[0-9a-f-]{36}$/.test(n.id)), JSON.stringify(sv.body));
  const porta = g?.nodes.find((n) => n.title === "A porta");
  const dentro = g?.nodes.find((n) => n.title === "Lá dentro");
  const fuga = g?.nodes.find((n) => n.title === "Fugiu");
  check("botões apontam para os uuids certos", porta?.choices.length === 2 && porta.choices[0].target === dentro?.id && porta.choices[1].target === fuga?.id);
  check("mídia de post alheio é ignorada; a própria fica", porta?.media_post_id === scene && dentro?.media_post_id === null);
  check("final não guarda botão", fuga?.choices.length === 0);

  const tooMany = { ...graph, root: porta.id, nodes: [{ ...graph.nodes[0], id: porta.id, choices: Array.from({ length: 5 }, (_, i) => ({ label: `b${i}`, target: porta.id })) }] };
  check("mais de 4 botões → 400", (await call("PUT", `/paths/${id}`, { token: tAU, body: tooMany })).status === 400);
  check("outro não salva o grafo do autor", (await call("PUT", `/paths/${id}`, { token: tV, body: graph })).status === 404);

  check("publicar em post alheio → 403", (await call("POST", `/paths/${id}/publish`, { token: tAU, body: { post_id: notMine } })).status === 403);
  const pub = await call("POST", `/paths/${id}/publish`, { token: tAU, body: { post_id: carrier } });
  check("publica preso ao post do autor", pub.status === 200 && pub.body?.story?.status === "published", JSON.stringify(pub.body));

  // Re-salvar com o MESMO id mantém o nó (e os contadores)
  const again = await call("PUT", `/paths/${id}`, { token: tAU, body: { ...g, nodes: g.nodes } });
  check("re-salvar mantém os ids", again.status === 200 && again.body.story.nodes.find((n) => n.id === porta.id));
  const broken = { ...g, nodes: g.nodes.map((n) => (n.id === porta.id ? { ...n, choices: [] } : n)) };
  check("publicada não aceita ficar incompleta", (await call("PUT", `/paths/${id}`, { token: tAU, body: broken })).status === 400);

  const play = await call("GET", `/paths/by-post/${carrier}`, { token: tV });
  const pn = play.body?.story?.nodes?.find((n) => n.id === porta.id);
  check("leitor recebe a história pelo post, com a mídia da cena", play.status === 200 && play.body.story.root === porta.id && pn?.media?.url === "https://r2.test/a.jpg" && pn.reach === undefined, JSON.stringify(play.body));
  check("anônimo também assiste", (await call("GET", `/paths/by-post/${carrier}`)).status === 200);
  await call("POST", `/paths/${id}/play`, {});
  const pk = await call("POST", `/paths/${id}/pick`, { body: { id_choice: porta.choices[0].id } });
  check("escolha conta e devolve o destino", pk.status === 200 && pk.body?.target === dentro.id);
  const stats = await call("GET", `/paths/${id}`, { token: tAU });
  check("autor vê plays, escolhas e chegadas", stats.body?.story?.plays === 1 && stats.body.story.nodes.find((n) => n.id === porta.id).choices[0].picks === 1 && stats.body.story.nodes.find((n) => n.id === dentro.id).reach === 1);

  // feed: o post carrega o id da história
  const PortfolioFeedStorage = require("../src/storages/PortfolioFeedStorage");
  const { shapeRow } = require("../src/services/portfolioFeed/PortfolioFeedService");
  const rows = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: [carrier] });
  check("shape do feed traz path_story_id", shapeRow(rows[0]).path_story_id === id);

  await call("POST", `/paths/${id}/unpublish`, { token: tAU });
  check("despublicada some do player", (await call("GET", `/paths/by-post/${carrier}`)).status === 404);
  check("apagar só pelo autor", (await call("DELETE", `/paths/${id}`, { token: tV })).status === 404 && (await call("DELETE", `/paths/${id}`, { token: tAU })).body?.ok === true);
}
module.exports.phases.push(f5);

// ── F6 · Feed sincronizado ─────────────────────────────────────────────────
async function f6() {
  console.log("━━━ F6 · Feed sincronizado ━━━");
  require("../src/realtime/socket").init(module.exports.server);
  const { io: ioc } = require("socket.io-client");
  const H = await createUser("Anfitrião H");
  const G = await createUser("Convidado G");
  const X = await createUser("Intruso X");
  const tH = tokenOf(H);
  const tG = tokenOf(G);
  const tX = tokenOf(X);
  const p1 = await mkPost(H.id_profile, "sync 1");
  const p2 = await mkPost(H.id_profile, "sync 2");
  const sock = (token) =>
    new Promise((resolve, reject) => {
      const s = ioc(base, { path: "/realtime", transports: ["websocket"], auth: { token }, reconnection: false });
      s.on("connect", () => resolve(s));
      s.on("connect_error", reject);
    });
  const wait = (s, ev, ms = 1500) =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        s.off(ev, on);
        resolve(null);
      }, ms);
      const on = (p) => {
        clearTimeout(t);
        s.off(ev, on);
        resolve(p);
      };
      s.on(ev, on);
    });
  const sH = await sock(tH);
  const sG = await sock(tG);
  const sX = await sock(tX);
  try {
    check("sem vínculo, convite de sync é recusado", (await call("POST", "/feed-interativo/sync", { token: tX, body: { id_user: G.id_user } })).status === 403);
    await linkPair(H, G);
    const gotInvite = wait(sG, "fi:sync");
    const inv = await call("POST", "/feed-interativo/sync", { token: tH, body: { id_user: G.id_user } });
    const sid = inv.body?.session?.id_session;
    check("H convida G", inv.status === 200 && inv.body.session.status === "invited" && inv.body.session.role === "host", JSON.stringify(inv.body));
    const ev = await gotInvite;
    check("G recebe o convite pelo socket", ev?.type === "invite" && ev.id_session === sid && ev.from?.username === H.username);
    check("H não aceita o próprio convite", (await call("POST", `/feed-interativo/sync/${sid}/accept`, { token: tH })).status === 403);
    check("X não vê a sessão", (await call("GET", `/feed-interativo/sync/${sid}`, { token: tX })).status === 404);
    const started = wait(sH, "fi:sync");
    const acc = await call("POST", `/feed-interativo/sync/${sid}/accept`, { token: tG });
    check("G aceita → ativa", acc.body?.session?.status === "active");
    check("H fica sabendo (started)", (await started)?.type === "started");

    const peer = wait(sH, "fi:sync:peer");
    sG.emit("sync:join", { id_session: sid });
    sH.emit("sync:join", { id_session: sid });
    sX.emit("sync:join", { id_session: sid });
    check("H vê o G entrar", (await peer)?.online === true);
    await new Promise((r) => setTimeout(r, 200));

    const gotState = wait(sG, "fi:sync:state");
    const gotX = wait(sX, "fi:sync:state", 500);
    sH.emit("sync:state", { id_session: sid, seq: 1, index: 1, post_id: p2, post_ids: [p1, p2, "lixo"], video: { playing: true, t: 3.5 } });
    const st = await gotState;
    check("G recebe o estado do H (lixo filtrado)", st?.index === 1 && st.post_id === p2 && st.post_ids?.length === 2 && st.video?.playing === true && st.from === H.id_user, JSON.stringify(st));
    check("X (fora da sessão) não recebe nada", (await gotX) === null);

    const hNo = wait(sH, "fi:sync:state", 500);
    sG.emit("sync:state", { id_session: sid, seq: 9, index: 0 });
    check("com controle do anfitrião, o G não conduz", (await hNo) === null);
    check("G não troca o controle", (await call("POST", `/feed-interativo/sync/${sid}/control`, { token: tG, body: { control: "shared" } })).status === 403);
    await call("POST", `/feed-interativo/sync/${sid}/control`, { token: tH, body: { control: "shared" } });
    const hYes = wait(sH, "fi:sync:state");
    sG.emit("sync:state", { id_session: sid, seq: 10, index: 0, post_id: p1 });
    check("controle dividido: o G também conduz", (await hYes)?.post_id === p1);

    const posts = await call("GET", `/feed-interativo/posts?ids=${p1},${p2}`, { token: tG });
    check("G carrega os posts do feed do H (régua com ele de leitor)", posts.body?.items?.length === 2);

    const ended = wait(sG, "fi:sync");
    await call("POST", `/feed-interativo/sync/${sid}/end`, { token: tH });
    check("encerrar avisa o outro lado", (await ended)?.type === "ended");
    const after = wait(sG, "fi:sync:state", 500);
    sH.emit("sync:state", { id_session: sid, seq: 11, index: 1 });
    check("depois de encerrada, nada passa", (await after) === null);

    // convite vencido
    const inv2 = await call("POST", "/feed-interativo/sync", { token: tH, body: { id_user: G.id_user } });
    await pool.query(`UPDATE tb_feed_sync_session SET created_at = NOW() - INTERVAL '3 minutes' WHERE id_session = $1`, [inv2.body.session.id_session]);
    check("convite com mais de 2 min não aceita", (await call("POST", `/feed-interativo/sync/${inv2.body.session.id_session}/accept`, { token: tG })).status === 409);
  } finally {
    sH.close();
    sG.close();
    sX.close();
  }
}
module.exports.phases.push(f6);

// ── F7 · Baú de doação (mig 460) ───────────────────────────────────────────
async function f7() {
  console.log("━━━ F7 · Baú de doação ━━━");
  const PG = require("../src/integrations/payments");
  const gw = { n: 0, last: null };
  PG.createCheckout = async (req) => {
    gw.last = req;
    gw.n++;
    return { id: `pref_bau_${gw.n}_${uid()}`, url: "https://mp.test/pay" };
  };
  PG.getChargeFee = async () => ({ fee_cents: 99, source: "test" });
  const W = require("../src/services/StripeWebhookService");
  const FeedBauService = require("../src/services/FeedBauService");

  const D = await createUser("Doador D");
  const R = await createUser("Recebe R");
  const N = await createUser("Sem CPF N");
  const O = await createUser("Outro estado O");
  const tD = tokenOf(D);
  const tR = tokenOf(R);
  const setPlace = async (u, uf, cpf) => {
    await pool.query(`UPDATE tb_profile SET estado = $2 WHERE id_user = $1 AND is_user_account`, [u.id_user, uf]);
    if (cpf) await pool.query(`UPDATE tb_user SET cpf = $2 WHERE id_user = $1`, [u.id_user, cpf]);
  };
  const cpf = () => String(Math.floor(1e10 + Math.random() * 8.9e10)).slice(0, 11);
  await setPlace(D, "PR", cpf());
  await setPlace(R, "PR", cpf());
  await setPlace(N, "PR", null);
  await setPlace(O, "BA", cpf());
  // Poço limpo: só os baús deste caso.
  await pool.query(`UPDATE tb_feed_bau_donation SET status = 'expired' WHERE status = 'paid'`);

  check("abaixo de R$ 1 → 400", (await call("POST", "/feed-interativo/baus", { token: tD, body: { amount_cents: 50, uf: "PR" } })).status === 400);
  check("acima de R$ 1 milhão → 400", (await call("POST", "/feed-interativo/baus", { token: tD, body: { amount_cents: 100000001, uf: "PR" } })).status === 400);
  check("estado inventado → 400", (await call("POST", "/feed-interativo/baus", { token: tD, body: { amount_cents: 1000, uf: "XX" } })).status === 400);
  const cr = await call("POST", "/feed-interativo/baus", { token: tD, body: { amount_cents: 10000, uf: "PR", message: "pra alegrar seu dia", anonymous: true } });
  check("doador compra o baú (checkout no gateway)", cr.status === 200 && !!cr.body?.checkout_url && gw.last?.amount_cents === 10000 && gw.last?.metadata?.type === "feed_bau", JSON.stringify(cr.body));
  const id_bau = cr.body?.id_bau;
  const sess = (await pool.query(`SELECT session_id FROM tb_feed_bau_donation WHERE id_bau = $1`, [id_bau])).rows[0].session_id;

  check("não pago não cai para ninguém", (await FeedBauService.tryAssign(R.id_user, { force: true })) === false);
  const session = { id: sess, metadata: { type: "feed_bau", id_bau }, payment_intent: `pay_${uid()}` };
  await W.fulfillCheckoutSession(session);
  await W.fulfillCheckoutSession(session);
  const paid = (await pool.query(`SELECT status, processor_fee_cents FROM tb_feed_bau_donation WHERE id_bau = $1`, [id_bau])).rows[0];
  check("webhook confirma (idempotente) e apura a tarifa", paid.status === "paid" && Number(paid.processor_fee_cents) === 99, JSON.stringify(paid));

  check("o doador não recebe o próprio baú", (await FeedBauService.tryAssign(D.id_user, { force: true })) === false);
  check("sem CPF não recebe", (await FeedBauService.tryAssign(N.id_user, { force: true })) === false);
  check("outro estado não recebe (antes de alargar)", (await FeedBauService.tryAssign(O.id_user, { force: true })) === false);
  check("alguém do PR recebe", (await FeedBauService.tryAssign(R.id_user, { force: true })) === true);
  check("o mesmo baú não cai em dois", (await FeedBauService.tryAssign(O.id_user, { force: true })) === false);

  const inbox = await call("GET", "/feed-interativo/inbox", { token: tR });
  const gift = inbox.body?.items?.find((x) => x.kind === "gift" && x.payload?.donation);
  check(
    "chega fechado, como doação anônima, sem valor nem mensagem",
    !!gift && gift.sender.username === null && gift.payload.anonymous === true && gift.payload.message === undefined && !JSON.stringify(gift.payload).includes("10000"),
    JSON.stringify(gift)
  );

  const op = await call("POST", `/feed-interativo/drops/${gift?.id_drop}/open`, { token: tR });
  const d = op.body?.gift?.donation;
  check(
    "abrir revela o valor e a conta (5% + MP + 5%)",
    op.status === 200 && d?.gross_cents === 10000 && d.platform_fee_cents === 500 && d.processor_fee_cents === 99 && d.withdraw_fee_cents === 470 && d.net_cents === 8931 && op.body.gift.message === "pra alegrar seu dia",
    JSON.stringify(op.body)
  );
  check("abrir de novo → 409", (await call("POST", `/feed-interativo/drops/${gift?.id_drop}/open`, { token: tR })).status === 409);

  const earn = await call("GET", "/me/earnings?kind=bau", { token: tR });
  check("cai em Recebimentos como 'bau' (pendente, holdback)", earn.body?.items?.length === 1 && earn.body.items[0].net_cents === 8931 && earn.body.items[0].status === "pending", JSON.stringify(earn.body));
  const all = await call("GET", "/me/earnings", { token: tR });
  check("os agregados de Recebimentos trazem o baú", all.status === 200 && !!all.body?.aggregates?.by_kind?.bau, JSON.stringify(all.body?.aggregates));

  const mine = await call("GET", "/feed-interativo/baus", { token: tD });
  check("doador vê o baú aberto, sem saber quem recebeu", mine.body?.baus?.[0]?.status === "opened" && !("id_receiver" in mine.body.baus[0]));

  await pool.query(`UPDATE tb_feed_bau_payout SET available_at = NOW() - INTERVAL '1 minute' WHERE id_bau = $1`, [id_bau]);
  const sw = await FeedBauService.sweep();
  check("varredura libera o repasse vencido", sw.released >= 1);
  const pid = (await pool.query(`SELECT id_payout FROM tb_feed_bau_payout WHERE id_bau = $1`, [id_bau])).rows[0].id_payout;
  check("usuário comum não marca pago", (await call("POST", `/admin/feed-bau/payouts/${pid}/mark-paid`, { token: tR })).status === 403);
  const mk = await FeedBauService.adminMarkPaid(pid, "pix ok");
  check("admin marca pago", mk.payout?.status === "pago");

  await W.dispatchEvent({ type: "charge.refunded", data: { object: { id: `ch_${uid()}`, payment_intent: session.payment_intent, amount: 10000, amount_refunded: 10000, refunded: true } } });
  const after = (await pool.query(`SELECT d.status AS ds, p.status AS ps FROM tb_feed_bau_donation d JOIN tb_feed_bau_payout p USING (id_bau) WHERE d.id_bau = $1`, [id_bau])).rows[0];
  check("estorno: baú refunded e repasse já pago vira 'devido'", after?.ds === "refunded" && after?.ps === "devido", JSON.stringify(after));

  const c2 = await call("POST", "/feed-interativo/baus", { token: tD, body: { amount_cents: 500, uf: "PR" } });
  const s2 = (await pool.query(`SELECT session_id FROM tb_feed_bau_donation WHERE id_bau = $1`, [c2.body.id_bau])).rows[0].session_id;
  await W.fulfillCheckoutSession({ id: s2, metadata: { type: "feed_bau", id_bau: c2.body.id_bau }, payment_intent: `pay_${uid()}` });
  const R2 = await createUser("Recebe R2");
  await setPlace(R2, "PR", cpf());
  check("R2 recebe o segundo baú", (await FeedBauService.tryAssign(R2.id_user, { force: true })) === true);
  await pool.query(`UPDATE tb_feed_bau_donation SET assigned_at = NOW() - INTERVAL '4 days' WHERE id_bau = $1`, [c2.body.id_bau]);
  const sw2 = await FeedBauService.sweep();
  const back = (await pool.query(`SELECT status FROM tb_feed_bau_donation WHERE id_bau = $1`, [c2.body.id_bau])).rows[0];
  check("não aberto em 3 dias volta ao poço", sw2.returned >= 1 && back.status === "paid");
  check("…e não cai de novo no R2", (await FeedBauService.tryAssign(R2.id_user, { force: true })) === false);

  const c3 = await call("POST", "/feed-interativo/baus", { token: tD, body: { amount_cents: 700, uf: "BA" } });
  const s3 = (await pool.query(`SELECT session_id FROM tb_feed_bau_donation WHERE id_bau = $1`, [c3.body.id_bau])).rows[0].session_id;
  await W.expireCheckoutSession({ id: s3, metadata: { type: "feed_bau", id_bau: c3.body.id_bau } }, "test");
  check("checkout abandonado → expired", (await pool.query(`SELECT status FROM tb_feed_bau_donation WHERE id_bau = $1`, [c3.body.id_bau])).rows[0].status === "expired");
  check("o fluxo está no radar de pagamentos (SOURCES)", require("../src/storages/PaymentOpsStorage").SOURCES.some((x) => x.flow === "bau_doacao"));
}
module.exports.phases.push(f7);
