// test/authz-feed.e2e.js — Segurança A1, lote 2 (feed/mídia): "quem pode o quê".
//
//   npm run test:authz:feed      (ou `npm run test:authz`, que roda os lotes)
//
// Pergunta por rota: se a conta B trocar o id da URL/corpo pelo da conta A, o
// servidor recusa? E o que nasceu DENTRO de comunidade privada/condomínio fica
// lá dentro (post exclusivo, bee do mural)?
// Tudo pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
//
// Seções:
//   0. anônimo → 401 em toda rota de feed/mídia que exige login;
//   1. portfólio da A: B não cria, edita, apaga, anexa nem sobe mídia (nem
//      pela própria URL apontando para o item da A, nem por /me/portfolio);
//   2. comentários: B não apaga o da A; post exclusivo de comunidade privada
//      não abre comentários para quem é de fora (ler nem escrever);
//   3. bees: B não apaga o da A; bee do mural de comunidade privada/condomínio
//      não sai na timeline, no perfil, por id, nem aceita curtida/comentário de
//      quem é de fora; bee de comunidade PÚBLICA continua global;
//   4. upload: chave do R2 de outra pessoa é recusada (bee e compressão);
//   5. live da A: B não encerra nem mexe no contador;
//   6. rotas de admin do feed recusam usuário comum (403).
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

async function createUser(nome) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email`,
    [nome, `authzf${uid()}`, `authzf${uid()}@t.test`]
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

async function mkItem(id_profile, title, id_exclusive_community = null) {
  const r = await pool.query(
    `INSERT INTO tb_profile_portfolio_item (id_profile, title, id_exclusive_community)
     VALUES ($1,$2,$3) RETURNING id_portfolio_item`,
    [id_profile, title, id_exclusive_community]
  );
  return r.rows[0].id_portfolio_item;
}

async function mkBee(u, caption, id_community = null) {
  const r = await pool.query(
    `INSERT INTO tb_story (id_profile, id_user, kind, video_url, duration_seconds, expires_at, caption, id_community)
     VALUES ($1,$2,'bee','https://r2.test/b.mp4',10, NOW() + INTERVAL '1 day', $3, $4)
     RETURNING id_story`,
    [u.id_profile, u.id_user, caption, id_community]
  );
  return r.rows[0].id_story;
}

const idsIn = (list, key) => (Array.isArray(list) ? list : []).map((x) => String(x?.[key]));

(async () => {
  const A = await createUser("Conta A");
  const B = await createUser("Conta B");
  const M = await createUser("Conta M"); // membro da comunidade privada da A
  const tA = tokenOf(A);
  const tB = tokenOf(B);
  const tM = tokenOf(M);
  const tag = uid();
  const communities = [];

  const priv = await mkCommunity(A.id_user, { kind: "common", privacy: "private", name: `Privada ${tag}` });
  const condo = await mkCommunity(A.id_user, { kind: "condo", privacy: "public", name: `Condo ${tag}` });
  const pub = await mkCommunity(A.id_user, { kind: "common", privacy: "public", name: `Publica ${tag}` });
  communities.push(priv, condo, pub);
  await CommunityStorage.addMember(pool, priv, M.id_user, "member");

  // Portfólio da A: um post comum e um exclusivo da comunidade privada.
  const itemA = await mkItem(A.id_profile, "Post A");
  const itemX = await mkItem(A.id_profile, "Post exclusivo", priv);
  const mediaA = (
    await pool.query(
      `INSERT INTO tb_profile_portfolio_media (id_portfolio_item, media_url, media_type)
       VALUES ($1,'https://r2.test/a.jpg','image') RETURNING id_portfolio_media`,
      [itemA]
    )
  ).rows[0].id_portfolio_media;
  const itemB = await mkItem(B.id_profile, "Post B");
  const cA = (
    await pool.query(
      `INSERT INTO tb_portfolio_comment (id_portfolio_item, id_user, content) VALUES ($1,$2,'comentário A') RETURNING id_portfolio_comment`,
      [itemA, A.id_user]
    )
  ).rows[0].id_portfolio_comment;
  const cX = (
    await pool.query(
      `INSERT INTO tb_portfolio_comment (id_portfolio_item, id_user, content) VALUES ($1,$2,'segredo da privada') RETURNING id_portfolio_comment`,
      [itemX, A.id_user]
    )
  ).rows[0].id_portfolio_comment;

  // Bees da A: global, mural da privada, mural do condomínio, mural da pública.
  const beeA = await mkBee(A, "bee global");
  const beeP = await mkBee(A, "bee da privada", priv);
  const beeC = await mkBee(A, "bee do condo", condo);
  const beeQ = await mkBee(A, "bee da pública", pub);
  const beeCommentA = (
    await pool.query(
      `INSERT INTO tb_story_comment (id_story, id_user, content) VALUES ($1,$2,'oi') RETURNING id_story_comment`,
      [beeA, A.id_user]
    )
  ).rows[0].id_story_comment;
  await pool.query(
    `INSERT INTO tb_story_comment (id_story, id_user, content) VALUES ($1,$2,'segredo no bee')`,
    [beeP, A.id_user]
  );
  // B segue a A (timeline "following" fica determinística, sem sorteio global).
  await pool.query(`INSERT INTO tb_user_follow (follower_user_id, target_profile_id) VALUES ($1,$2)`, [B.id_user, A.id_profile]);
  await pool.query(`INSERT INTO tb_user_follow (follower_user_id, target_profile_id) VALUES ($1,$2)`, [M.id_user, A.id_profile]);

  const live = (
    await pool.query(
      `INSERT INTO tb_live (id_profile, id_user, room_name) VALUES ($1,$2,$3) RETURNING id_live`,
      [A.id_profile, A.id_user, `sala-${tag}`]
    )
  ).rows[0].id_live;

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ═══ 0. anônimo ═══════════════════════════════════════════════════════
    console.log("\n━━━ 0. sem login → 401 ━━━");
    const PRIVATE_ROUTES = [
      ["POST", `/profile/${A.id_profile}/portfolio`], ["PATCH", `/profile/${A.id_profile}/portfolio/${itemA}`],
      ["DELETE", `/profile/${A.id_profile}/portfolio/${itemA}`], ["POST", `/profile/${A.id_profile}/portfolio/${itemA}/media`],
      ["DELETE", `/profile/${A.id_profile}/portfolio/${itemA}/media/${mediaA}`],
      ["POST", `/profile/${A.id_profile}/portfolio/${itemA}/upload`],
      ["GET", "/me/portfolio"], ["POST", "/me/portfolio"], ["PATCH", `/me/portfolio/${itemA}`], ["DELETE", `/me/portfolio/${itemA}`],
      ["POST", `/portfolio/items/${itemA}/comments`], ["POST", `/portfolio/comments/${cA}/like`], ["DELETE", `/portfolio/comments/${cA}`],
      ["POST", `/portfolio/items/${itemA}/report`],
      ["GET", "/me/stories"], ["POST", "/me/stories"], ["POST", "/me/stories/upload-url"], ["POST", "/me/stories/upload-proxy"],
      ["POST", "/me/stories/from-upload"], ["DELETE", `/me/stories/${beeA}`],
      ["GET", "/stories/feed"], ["GET", `/stories/by-profile/${A.id_profile}`], ["GET", `/stories/by-user/${A.id_user}`],
      ["POST", `/stories/${beeA}/view`], ["POST", `/stories/${beeA}/react`],
      ["GET", "/bees/timeline"], ["GET", "/bees/bookmarks"], ["GET", `/bees/${beeA}`],
      ["POST", `/bees/${beeA}/like`], ["POST", `/bees/${beeA}/dislike`], ["POST", `/bees/${beeA}/report`], ["POST", `/bees/${beeA}/bookmark`],
      ["POST", `/bees/items/${beeA}/comments`], ["DELETE", `/bees/comments/${beeCommentA}`],
      ["POST", "/me/compress/upload-url"], ["POST", "/me/compress/from-upload"], ["GET", "/me/engagement"],
      ["GET", "/audio-library"], ["GET", "/lives"], ["POST", "/lives"], ["POST", `/lives/${live}/end`],
      ["POST", `/lives/${live}/viewers`], ["POST", `/lives/${live}/join`], ["POST", `/lives/${live}/gift`],
      ["GET", "/entity-follows/me/summary"], ["POST", "/entity-follows"], ["DELETE", "/entity-follows"],
      ["GET", "/manifestations/me"], ["POST", "/manifestations/apply"], ["PUT", `/manifestations/profiles/${A.id_profile}/apply`],
    ];
    for (const [m, p] of PRIVATE_ROUTES) {
      const r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} sem token = 401`, r.status === 401, `veio ${r.status}`);
    }

    // ═══ 1. portfólio da A ═══════════════════════════════════════════════
    console.log("\n━━━ 1. B contra o portfólio da A ━━━");
    const snapItems = () =>
      pool
        .query(
          `SELECT i.id_portfolio_item, i.title, i.is_active,
                  (SELECT json_agg(json_build_object('id', m.id_portfolio_media, 'a', m.is_active) ORDER BY m.id_portfolio_media)
                     FROM tb_profile_portfolio_media m WHERE m.id_portfolio_item = i.id_portfolio_item) AS media
             FROM tb_profile_portfolio_item i WHERE i.id_profile = $1 ORDER BY i.id_portfolio_item`,
          [A.id_profile]
        )
        .then((q) => JSON.stringify(q.rows));
    const before = await snapItems();
    let r = await call("POST", `/profile/${A.id_profile}/portfolio`, { token: tB, body: { title: "invasor" } });
    check("B não cria post no perfil da A", r.status >= 400, `veio ${r.status}`);
    r = await call("PATCH", `/profile/${A.id_profile}/portfolio/${itemA}`, { token: tB, body: { title: "invadido" } });
    check("B não edita post da A", r.status >= 400, `veio ${r.status}`);
    r = await call("DELETE", `/profile/${A.id_profile}/portfolio/${itemA}`, { token: tB });
    check("B não apaga post da A", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", `/profile/${A.id_profile}/portfolio/${itemA}/media`, {
      token: tB, body: { media_url: "https://evil.test/x.jpg", media_type: "image" },
    });
    check("B não anexa mídia no post da A", r.status >= 400, `veio ${r.status}`);
    r = await call("DELETE", `/profile/${A.id_profile}/portfolio/${itemA}/media/${mediaA}`, { token: tB });
    check("B não desliga mídia do post da A", r.status >= 400, `veio ${r.status}`);
    // Trocar só o item: a URL é do perfil da B (dono confere), o item é da A.
    r = await call("PATCH", `/profile/${B.id_profile}/portfolio/${itemA}`, { token: tB, body: { title: "invadido" } });
    check("B não edita post da A pela URL do próprio perfil", r.status >= 400, `veio ${r.status}`);
    r = await call("DELETE", `/profile/${B.id_profile}/portfolio/${itemA}/media/${mediaA}`, { token: tB });
    check("B não desliga mídia da A pela URL do próprio perfil", r.status >= 400, `veio ${r.status}`);
    r = await call("PATCH", `/me/portfolio/${itemA}`, { token: tB, body: { title: "invadido" } });
    check("B não edita post da A por /me/portfolio", r.status >= 400, `veio ${r.status}`);
    r = await call("DELETE", `/me/portfolio/${itemA}`, { token: tB });
    check("B não apaga post da A por /me/portfolio", r.status >= 400, `veio ${r.status}`);
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "a.png");
    let res = await fetch(`${base}/profile/${A.id_profile}/portfolio/${itemA}/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${tB}` }, body: fd,
    });
    check("B não sobe arquivo no post da A", res.status >= 400, `veio ${res.status}`);
    const after = await snapItems();
    check("banco: posts e mídias da A intactos", after === before, after);
    r = await call("GET", `/public/portfolio-item/${itemX}`);
    check("post exclusivo da privada não tem página pública (404)", r.status === 404, `veio ${r.status}`);
    r = await call("GET", `/profile/${A.id_profile}/portfolio`);
    check("lista pública do perfil não traz o post exclusivo", !idsIn(r.body?.items, "id_portfolio_item").includes(String(itemX)));

    // ═══ 2. comentários ══════════════════════════════════════════════════
    console.log("\n━━━ 2. comentários ━━━");
    r = await call("DELETE", `/portfolio/comments/${cA}`, { token: tB });
    check("B não apaga comentário da A (403)", r.status === 403, `veio ${r.status}`);
    r = await call("GET", `/portfolio/items/${itemA}/comments`);
    check("anônimo lê comentários de post público", r.status === 200 && idsIn(r.body?.items, "id_portfolio_comment").includes(String(cA)));
    r = await call("GET", `/portfolio/items/${itemX}/comments`);
    check("anônimo NÃO lê comentários de post exclusivo da privada",
      !idsIn(r.body?.items, "id_portfolio_comment").includes(String(cX)), `veio ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    r = await call("GET", `/portfolio/items/${itemX}/comments`, { token: tB });
    check("B (de fora) NÃO lê comentários do post exclusivo",
      !idsIn(r.body?.items, "id_portfolio_comment").includes(String(cX)), `veio ${r.status}`);
    r = await call("GET", `/portfolio/items/${itemX}/comments`, { token: tM });
    check("M (membro) lê comentários do post exclusivo", r.status === 200 && idsIn(r.body?.items, "id_portfolio_comment").includes(String(cX)), `veio ${r.status}`);
    r = await call("POST", `/portfolio/items/${itemX}/comments`, { token: tB, body: { content: "entrei" } });
    check("B (de fora) NÃO comenta no post exclusivo", r.status >= 400, `veio ${r.status}`);
    const nB = await pool.query(`SELECT count(*)::int n FROM tb_portfolio_comment WHERE id_portfolio_item=$1 AND id_user=$2`, [itemX, B.id_user]);
    check("banco: nenhum comentário da B no post exclusivo", nB.rows[0].n === 0, `n=${nB.rows[0].n}`);
    r = await call("POST", `/portfolio/items/${itemX}/comments`, { token: tA, body: { content: "sou a autora" } });
    check("A (autora) comenta no próprio post exclusivo", r.status === 201 || r.status === 200, `veio ${r.status}`);

    // ═══ 3. bees ═════════════════════════════════════════════════════════
    console.log("\n━━━ 3. bees ━━━");
    r = await call("DELETE", `/me/stories/${beeA}`, { token: tB });
    const beeAlive = await pool.query(`SELECT deleted_at FROM tb_story WHERE id_story=$1`, [beeA]);
    check("B não apaga bee da A", beeAlive.rows[0].deleted_at === null, `veio ${r.status}`);
    r = await call("DELETE", `/bees/comments/${beeCommentA}`, { token: tB });
    check("B não apaga comentário de bee da A (403)", r.status === 403, `veio ${r.status}`);

    r = await call("GET", "/bees/timeline?scope=following&limit=50", { token: tB });
    let tl = idsIn(r.body?.items, "id_story");
    check("timeline da B traz o bee global da A", tl.includes(String(beeA)), `veio ${r.status} ${tl.length} itens`);
    check("timeline da B traz o bee da comunidade PÚBLICA", tl.includes(String(beeQ)));
    check("timeline da B NÃO traz bee do mural da privada", !tl.includes(String(beeP)));
    check("timeline da B NÃO traz bee do mural do condomínio", !tl.includes(String(beeC)));

    r = await call("GET", "/stories/feed", { token: tB });
    const feedIds = JSON.stringify(r.body || {});
    check("StoryBar da B NÃO traz bee da privada nem do condomínio",
      !feedIds.includes(String(beeP)) && !feedIds.includes(String(beeC)), `veio ${r.status}`);
    for (const p of [`/stories/by-profile/${A.id_profile}`, `/stories/by-user/${A.id_user}`]) {
      r = await call("GET", p, { token: tB });
      const ids = idsIn(r.body?.items, "id_story");
      check(`${p.replace(/[0-9a-f-]{36}/g, ":id")} (B) traz o global e esconde privada/condomínio`,
        ids.includes(String(beeA)) && !ids.includes(String(beeP)) && !ids.includes(String(beeC)), JSON.stringify(ids));
    }

    r = await call("GET", `/bees/${beeP}`, { token: tB });
    check("B NÃO abre o bee da privada por id (404)", r.status === 404, `veio ${r.status}`);
    r = await call("GET", `/bees/${beeC}`, { token: tB });
    check("B NÃO abre o bee do condomínio por id (404)", r.status === 404, `veio ${r.status}`);
    r = await call("GET", `/bees/${beeP}`, { token: tM });
    check("M (membro) abre o bee da privada", r.status === 200, `veio ${r.status}`);
    r = await call("GET", `/bees/${beeC}`, { token: tA });
    check("A (autora) abre o próprio bee do condomínio", r.status === 200, `veio ${r.status}`);
    r = await call("GET", `/bees/${beeQ}`, { token: tB });
    check("B abre bee da comunidade pública", r.status === 200, `veio ${r.status}`);

    r = await call("GET", `/bees/items/${beeP}/comments`, { token: tB });
    check("B NÃO lê comentários do bee da privada", !JSON.stringify(r.body || {}).includes("segredo no bee"), `veio ${r.status}`);
    r = await call("GET", `/bees/items/${beeP}/comments`);
    check("anônimo NÃO lê comentários do bee da privada", !JSON.stringify(r.body || {}).includes("segredo no bee"), `veio ${r.status}`);
    r = await call("GET", `/bees/items/${beeP}/comments`, { token: tM });
    check("M (membro) lê comentários do bee da privada", JSON.stringify(r.body || {}).includes("segredo no bee"), `veio ${r.status}`);

    const engBefore = await pool.query(`SELECT likes_count, comments_count FROM tb_story WHERE id_story=$1`, [beeP]);
    for (const [m, p, body] of [
      ["POST", `/bees/${beeP}/like`],
      ["POST", `/bees/${beeP}/bookmark`],
      ["POST", `/bees/items/${beeP}/comments`, { content: "entrei" }],
      ["POST", `/stories/${beeP}/view`],
      ["POST", `/stories/${beeP}/react`, { emoji: "🔥" }],
    ]) {
      r = await call(m, p, { token: tB, body: body || {} });
      check(`B de fora: ${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} recusado`, r.status >= 400, `veio ${r.status}`);
    }
    const engAfter = await pool.query(`SELECT likes_count, comments_count FROM tb_story WHERE id_story=$1`, [beeP]);
    const traces = await pool.query(
      `SELECT (SELECT count(*) FROM tb_story_like WHERE id_story=$1 AND id_user=$2)
            + (SELECT count(*) FROM tb_story_bookmark WHERE id_story=$1 AND id_user=$2)
            + (SELECT count(*) FROM tb_story_view WHERE id_story=$1 AND id_viewer_user=$2)
            + (SELECT count(*) FROM tb_story_comment WHERE id_story=$1 AND id_user=$2) AS n`,
      [beeP, B.id_user]
    );
    check("banco: nenhum rastro da B no bee da privada",
      Number(traces.rows[0].n) === 0 && JSON.stringify(engAfter.rows) === JSON.stringify(engBefore.rows), `n=${traces.rows[0].n}`);

    // ═══ 4. chaves do R2 ═════════════════════════════════════════════════
    console.log("\n━━━ 4. upload com chave de outra pessoa ━━━");
    r = await call("POST", "/me/stories/from-upload", {
      token: tB, body: { id_profile: A.id_profile, storage_key: `stories/${A.id_profile}/bee-x.mp4`, duration_seconds: 5 },
    });
    check("B não publica bee pelo perfil da A", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", "/me/stories/from-upload", {
      token: tB, body: { id_profile: B.id_profile, storage_key: `stories/${A.id_profile}/bee-x.mp4`, duration_seconds: 5 },
    });
    check("B não publica bee com a chave da pasta da A", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", "/me/stories/from-upload", {
      token: tB, body: { id_profile: B.id_profile, storage_key: `stories/${B.id_profile}/../${A.id_profile}/bee-x.mp4`, duration_seconds: 5 },
    });
    check("B não escapa da própria pasta com '..'", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", "/me/compress/from-upload", {
      token: tB, body: { storage_key: `temp-compress/${A.id_user}/job/input.mp4` },
    });
    check("B não comprime o vídeo da pasta da A", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", "/me/stories/upload-url", { token: tB, body: { id_profile: A.id_profile } });
    check("B não pede URL de upload pelo perfil da A", r.status >= 400, `veio ${r.status}`);
    const nBee = await pool.query(`SELECT count(*)::int n FROM tb_story WHERE id_user=$1`, [B.id_user]);
    check("banco: nenhum bee criado pela B", nBee.rows[0].n === 0, `n=${nBee.rows[0].n}`);

    // ═══ 5. live ═════════════════════════════════════════════════════════
    console.log("\n━━━ 5. B contra a live da A ━━━");
    r = await call("POST", `/lives/${live}/end`, { token: tB });
    check("B não encerra a live da A", r.status >= 400, `veio ${r.status}`);
    r = await call("POST", `/lives/${live}/viewers`, { token: tB, body: { count: 99999 } });
    check("B não mexe no contador da live da A", r.status >= 400, `veio ${r.status}`);
    const lv = await pool.query(`SELECT status, peak_viewers FROM tb_live WHERE id_live=$1`, [live]);
    check("banco: live da A segue no ar, pico intacto", lv.rows[0].status === "live" && Number(lv.rows[0].peak_viewers) === 0, JSON.stringify(lv.rows));
    r = await call("PUT", `/manifestations/profiles/${A.id_profile}/apply`, { token: tB, body: { apply: true } });
    check("B não aplica manifestação no perfil da A", r.status >= 400, `veio ${r.status}`);

    // ═══ 6. admin ════════════════════════════════════════════════════════
    console.log("\n━━━ 6. usuário comum em rota de admin do feed → 403 ━━━");
    const ADMIN_ROUTES = [
      ["GET", "/admin/posts"], ["GET", `/admin/posts/${itemA}`], ["POST", `/admin/posts/${itemA}/ban`],
      ["POST", `/admin/posts/${itemA}/unban`], ["POST", `/admin/posts/${itemA}/resolve`], ["GET", "/admin/alerts/summary"],
      ["GET", "/bees/admin/reports"], ["POST", `/bees/admin/${beeA}/remove`], ["POST", `/bees/admin/${beeA}/resolve`],
      ["GET", "/admin/audio-library"], ["POST", "/admin/audio-library"], ["DELETE", "/admin/audio-library/1"],
      ["GET", "/admin/enxames"], ["POST", "/admin/enxames"], ["PATCH", "/admin/enxames/1"],
      ["GET", "/admin/lives/gifts"], ["POST", "/admin/lives/gifts"], ["GET", "/admin/live-clusters"],
      ["GET", "/admin/manifestations/dashboard"], ["POST", "/admin/manifestations/products"],
    ];
    for (const [m, p] of ADMIN_ROUTES) {
      r = await call(m, p, { token: tB, body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} com conta comum = 403`, r.status === 403, `veio ${r.status}`);
    }
    const banned = await pool.query(`SELECT is_banned FROM tb_profile_portfolio_item WHERE id_portfolio_item=$1`, [itemA]);
    check("banco: post da A não foi banido", banned.rows[0].is_banned === false);
  } finally {
    server.close();
    await pool.query(`DELETE FROM tb_live WHERE id_live = $1`, [live]).catch(() => {});
    await pool.query(`DELETE FROM tb_profile WHERE id_profile = ANY($1::uuid[])`, [communities]).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [[A.id_user, B.id_user, M.id_user]]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
