// test/authz-comercio.e2e.js — Segurança A1, lote 5 (comércio e vitrine),
// mais as duas decisões do lote 1/3 resolvidas aqui (A1-02 e A1-15).
//
//   npm run test:authz:comercio   (ou `npm run test:authz`, que roda os lotes)
//
// Pergunta por rota: se a conta B trocar o id da URL ou do corpo pelo da A, o
// servidor recusa? E o que é de dentro da vitrine do prédio fica lá dentro?
// Tudo pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
//
// Seções:
//   0. anônimo → 401 nas rotas do lote;
//   1. loja do perfil: B, dona do PRÓPRIO perfil, põe na URL o produto da A
//      e tenta listar, reordenar e apagar a mídia dele (A1-20), editar e
//      apagar o produto; e direto no perfil da A → 403;
//   2. produto público não devolve o CEP de origem do vendedor (A1-21);
//   3. vitrine e entregas do condomínio: B (de fora) não lê nem publica;
//      morador M não edita/arquiva anúncio da A nem mexe no chamado dela;
//   4. quem só reivindicou apartamento ocupado (pendente) não lê o mural nem
//      os avisos e não publica (A1-15, A1-13); recibo de leitura de aviso de
//      OUTRO prédio é recusado (A1-14);
//   5. mercado local: B não lê os anúncios de um prédio pelo relatório (A1-22);
//   6. nascimento: PUT /users/me não troca a data (A1-02);
//   7. rotas de admin do lote recusam usuário comum (403).
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

const pool = require("../src/databases");
const app = require("../src/app");
const CommunityStorage = require("../src/storages/CommunityStorage");
const CommunityDeliveryStorage = require("../src/storages/CommunityDeliveryStorage");
const CondoNoticeStorage = require("../src/storages/CondoNoticeStorage");
const CondoResidenceService = require("../src/services/CondoResidenceService");

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
    [nome, `authzm${uid()}`, `authzm${uid()}@t.test`]
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

async function mkCondo(owner, name) {
  const { rows } = await pool.query(`SELECT id_machine FROM tb_machine ORDER BY id_machine LIMIT 1`);
  const c = await CommunityStorage.createCommunity(pool, {
    id_user: owner,
    id_machine: rows[0].id_machine,
    display_name: name,
    bio: null,
    avatar_url: null,
    theme: null,
    kind: "condo",
    address: {
      street: "Rua Comercio", number: String(Math.floor(Math.random() * 9000) + 1), complement: null,
      neighborhood: "Centro", cep: "01310100", estado: "SP", municipio: "Sao Paulo",
    },
  });
  await CommunityStorage.addMember(pool, c.id_profile, owner, "leader");
  return c.id_profile;
}

async function mkProduct(u, name) {
  const r = await pool.query(
    `INSERT INTO tb_profile_product (id_profile, name, price_amount, stock_quantity, origin_zipcode_override,
                                     id_product_category, is_active)
     VALUES ($1, $2, 1500, 3, '04567000',
             (SELECT id_product_category FROM tb_product_category ORDER BY id_product_category LIMIT 1), TRUE)
     RETURNING id_profile_product`,
    [u.id_profile, name]
  );
  return r.rows[0].id_profile_product;
}
async function mkMedia(u, id_product, i) {
  const r = await pool.query(
    `INSERT INTO tb_profile_product_media (id_profile_product, id_profile, media_url, media_type, sort_order)
     VALUES ($1, $2, $3, 'image', $4) RETURNING id_product_media`,
    [id_product, u.id_profile, `https://r2.test/p/${uid()}.jpg`, i]
  );
  return r.rows[0].id_product_media;
}

const FLAGS = ["condominio", "delivery_vizinho", "vitrine_venda", "mercado_local", "store"];

(async () => {
  const users = [];
  const communities = [];
  let server;
  const flagsBefore = (
    await pool.query(`SELECT flag_key, is_enabled FROM tb_feature_flag WHERE flag_key = ANY($1)`, [FLAGS])
  ).rows;
  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE WHERE flag_key = ANY($1)`, [FLAGS]);

  try {
    const A = await createUser("Ana Comercio");    // líder do prédio 1, vende na loja
    const B = await createUser("Bia DeFora");      // de fora; tem a própria loja
    const M = await createUser("Mauro Morador");   // morador reconhecido do prédio 1
    const P = await createUser("Paulo Pendente");  // reivindicou apto ocupado
    users.push(A, B, M, P);
    const [tA, tB, tM, tP] = [A, B, M, P].map(tokenOf);

    const condo = await mkCondo(A.id_user, `Condo Comercio ${tag}`);
    const condo2 = await mkCondo(B.id_user, `Condo Outro ${tag}`);
    communities.push(condo, condo2);

    // Planta do prédio 1: A mora no 101, M no 102 (vazios → reconhecidos na
    // hora); P pede o 101, que já tem dona → pendente.
    const blk = await CondoResidenceService.createBlock({ id_user: A.id_user }, { id_condo: condo }, {
      name: "Torre", floors: 1, units_per_floor: 2, first_floor: 1,
    });
    if (blk.error) throw new Error(`planta: ${blk.error}`);
    const plant = await CondoResidenceService.getPlant({ id_user: A.id_user }, { id_condo: condo });
    const u101 = plant.units.find((u) => u.label === "101");
    const u102 = plant.units.find((u) => u.label === "102");
    const cA = await CondoResidenceService.claimUnit({ id_user: A.id_user }, { id_condo: condo }, { id_unit: u101.id_unit });
    const cM = await CondoResidenceService.claimUnit({ id_user: M.id_user }, { id_condo: condo }, { id_unit: u102.id_unit });
    const cP = await CondoResidenceService.claimUnit({ id_user: P.id_user }, { id_condo: condo }, { id_unit: u101.id_unit });
    if (cA.status !== "recognized" || cM.status !== "recognized" || cP.status !== "pending") {
      throw new Error(`moradia: A=${cA.status || cA.error} M=${cM.status || cM.error} P=${cP.status || cP.error}`);
    }

    // Anúncio da A, pago e no ar.
    const lst = await pool.query(
      `INSERT INTO tb_condo_listing (id_condo, id_user, kind, title, price_cents, paid_until)
       VALUES ($1, $2, 'service', $3, 4000, NOW() + INTERVAL '20 days') RETURNING id_listing`,
      [condo, A.id_user, `Corte secreto ${tag}`]
    );
    const id_listing = lst.rows[0].id_listing;

    // Chamado de entrega aberto pela A.
    const deliv = await CommunityDeliveryStorage.create(pool, {
      id_community: condo, id_requester: A.id_user, kind: "parcel", price_cents: 500,
      note: "portaria", pickup: "Portaria", dropoff: "Apto 101",
      expires_at: new Date(Date.now() + 3600e3),
    });

    // Recado no mural e aviso do prédio 1; aviso do prédio 2 (da B).
    await CommunityStorage.createRecado(pool, condo, { body: `recado interno ${tag}`, id_author_user: A.id_user, sport: null });
    await CommunityStorage.createAnnouncement(pool, condo, { body: "aviso interno", is_pinned: false, created_by_user: A.id_user });
    const notice2 = await CondoNoticeStorage.create(pool, {
      id_condo: condo2, id_author: B.id_user, scope: "general", title: "aviso", body: "aviso do outro prédio",
    });

    // Loja: produto da A com 2 fotos; B também tem um produto (loja própria).
    const prodA = await mkProduct(A, `Bolo da Ana ${tag}`);
    const mA1 = await mkMedia(A, prodA, 0);
    const mA2 = await mkMedia(A, prodA, 1);
    await mkProduct(B, `Pao da Bia ${tag}`);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    // ═══ 0. anônimo ═════════════════════════════════════════════════════
    console.log("\n━━━ 0. anônimo → 401 ━━━");
    for (const [m, p] of [
      ["GET", `/communities/${condo}/listings`], ["POST", `/communities/${condo}/listings`],
      ["GET", `/communities/${condo}/deliveries`], ["GET", `/communities/${condo}/orders/mine`],
      ["GET", `/condos/${condo}/listings`], ["GET", `/profile/${A.id_profile}/products`],
      ["DELETE", `/profile/${A.id_profile}/products/${prodA}/media/${mA1}`],
      ["GET", "/me/orders"], ["GET", "/me/sales"], ["GET", "/order"], ["GET", "/me/seller-balance"],
      ["GET", "/product-requests/me"], ["GET", "/debts/mine"], ["GET", "/local-market/report"],
      ["GET", `/profile/${A.id_profile}/product-collections`], ["PUT", "/users/me"],
    ]) {
      const r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} → 401`, r.status === 401, `veio ${r.status}`);
    }

    // ═══ 1. loja do perfil ══════════════════════════════════════════════
    console.log("\n━━━ 1. loja do perfil: B contra o produto da A ━━━");
    let r = await call("GET", `/profile/${B.id_profile}/products/${prodA}/media`, { token: tB });
    check("B não lista a mídia do produto da A pela URL do próprio perfil (A1-20)",
      r.status === 404 || r.status === 403, `veio ${r.status} com ${(r.body?.media || []).length} mídias`);
    r = await call("PATCH", `/profile/${B.id_profile}/products/${prodA}/media/reorder`, {
      token: tB, body: { ordered_ids: [mA2, mA1] },
    });
    check("B não reordena a mídia do produto da A (A1-20)", r.status === 404 || r.status === 403, `veio ${r.status}`);
    const ord = await pool.query(
      `SELECT id_product_media FROM tb_profile_product_media WHERE id_profile_product=$1 ORDER BY sort_order`, [prodA]
    );
    check("ordem das fotos da A intacta", String(ord.rows[0]?.id_product_media) === String(mA1));
    r = await call("DELETE", `/profile/${B.id_profile}/products/${prodA}/media/${mA1}`, { token: tB });
    check("B não apaga a foto do produto da A (A1-20)", r.status === 404 || r.status === 403, `veio ${r.status}`);
    const left = await pool.query(`SELECT count(*)::int n FROM tb_profile_product_media WHERE id_profile_product=$1`, [prodA]);
    check("as 2 fotos da A continuam no banco", left.rows[0].n === 2, `sobraram ${left.rows[0].n}`);
    r = await call("PATCH", `/profile/${B.id_profile}/products/${prodA}`, { token: tB, body: { name: "tomado" } });
    check("B não edita o produto da A pela própria URL", r.status === 404, `veio ${r.status}`);
    r = await call("DELETE", `/profile/${B.id_profile}/products/${prodA}`, { token: tB });
    check("B não apaga o produto da A pela própria URL", r.status === 404, `veio ${r.status}`);
    for (const [m, p, body] of [
      ["GET", `/profile/${A.id_profile}/products`],
      ["PATCH", `/profile/${A.id_profile}/products/${prodA}`, { name: "tomado" }],
      ["DELETE", `/profile/${A.id_profile}/products/${prodA}`],
      ["GET", `/profile/${A.id_profile}/products/${prodA}/media`],
      ["DELETE", `/profile/${A.id_profile}/products/${prodA}/media/${mA1}`],
      ["GET", `/profile/${A.id_profile}/product-collections`],
      ["POST", `/profile/${A.id_profile}/product-collections`, { name: "x" }],
    ]) {
      const rr = await call(m, p, { token: tB, body });
      check(`B → ${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} no perfil da A → 403`, rr.status === 403, `veio ${rr.status}`);
    }
    r = await call("POST", `/profile/${A.id_profile}/products`, { token: tB, body: { name: "intruso", price_amount: 100 } });
    const intr = await pool.query(`SELECT count(*)::int n FROM tb_profile_product WHERE id_profile=$1 AND name='intruso'`, [A.id_profile]);
    check("B não cria produto na loja da A", r.status >= 400 && r.status < 500 && intr.rows[0].n === 0, `veio ${r.status}`);
    const prodRow = await pool.query(`SELECT name, deleted_at FROM tb_profile_product WHERE id_profile_product=$1`, [prodA]);
    check("produto da A intacto", prodRow.rows[0].name === `Bolo da Ana ${tag}` && !prodRow.rows[0].deleted_at);
    r = await call("GET", "/me/sales", { token: tB });
    check("vendas de B não trazem nada da A", r.status === 200 && !(r.body?.orders || []).some((o) => String(o.id_seller_profile) === String(A.id_profile)));

    // ═══ 2. produto público ════════════════════════════════════════════
    console.log("\n━━━ 2. produto público sem CEP de origem ━━━");
    r = await call("GET", `/public/profile/${A.id_profile}/products`);
    const pubList = r.body?.products || [];
    check("vitrine pública da loja responde", r.status === 200 && pubList.length >= 1, `veio ${r.status}`);
    check("lista pública não tem o CEP de origem (A1-21)", !pubList.some((p) => "origin_zipcode_override" in p),
      "origin_zipcode_override na resposta");
    r = await call("GET", `/public/profile/${A.id_profile}/products/${prodA}`);
    check("produto público por id responde", r.status === 200, `veio ${r.status}`);
    check("produto público por id não tem o CEP de origem (A1-21)",
      r.body?.product && !("origin_zipcode_override" in r.body.product), "origin_zipcode_override na resposta");

    // ═══ 3. vitrine e entregas do condomínio ═══════════════════════════
    console.log("\n━━━ 3. vitrine e entregas do condomínio ━━━");
    for (const [m, p, body] of [
      ["GET", `/communities/${condo}/listings`],
      ["GET", `/communities/${condo}/listings/quota`],
      ["POST", `/communities/${condo}/listings`, { kind: "service", title: "intruso" }],
      ["PATCH", `/communities/${condo}/listings/${id_listing}`, { title: "tomado" }],
      ["GET", `/condos/${condo}/listings`],
      ["GET", `/communities/${condo}/deliveries`],
      ["POST", `/communities/${condo}/deliveries`, { kind: "parcel" }],
      ["POST", `/communities/${condo}/deliveries/${deliv.id_delivery}/accept`],
      ["POST", `/communities/${condo}/listings/${id_listing}/checkout`],
    ]) {
      const rr = await call(m, p, { token: tB, body });
      check(`B (de fora) → ${m} ${p.replace(/[0-9a-f-]{36}/g, ":id")} → 403`, rr.status === 403, `veio ${rr.status}`);
    }
    r = await call("GET", `/communities/${condo}/listings`, { token: tM });
    check("morador M vê a vitrine (controle)", r.status === 200 && (r.body?.listings || []).some((l) => l.id_listing == id_listing), `veio ${r.status}`);
    r = await call("PATCH", `/communities/${condo}/listings/${id_listing}`, { token: tM, body: { title: "tomado" } });
    check("M não edita o anúncio da A", r.status === 403, `veio ${r.status}`);
    r = await call("PATCH", `/communities/${condo}/listings/${id_listing}/status`, { token: tM, body: { status: "archived" } });
    check("M não arquiva o anúncio da A", r.status === 403, `veio ${r.status}`);
    r = await call("PATCH", `/communities/${condo2}/listings/${id_listing}`, { token: tB, body: { title: "tomado" } });
    check("B (líder do prédio 2) não edita o anúncio pela URL do próprio prédio", r.status === 404, `veio ${r.status}`);
    const lRow = await pool.query(`SELECT title, status FROM tb_condo_listing WHERE id_listing=$1`, [id_listing]);
    check("anúncio da A intacto", lRow.rows[0].title === `Corte secreto ${tag}` && lRow.rows[0].status === "active");
    for (const [m, sub, body] of [
      ["POST", "offer", { price_cents: 99999 }],
      ["POST", "confirm"],
      ["POST", "cancel"],
      ["POST", "delivered"],
      ["POST", "release"],
    ]) {
      const rr = await call(m, `/communities/${condo}/deliveries/${deliv.id_delivery}/${sub}`, { token: tM, body });
      check(`M não mexe no chamado da A (${sub})`, rr.status >= 400 && rr.status < 500 && rr.status !== 401, `veio ${rr.status}`);
    }
    const dRow = await pool.query(`SELECT status, price_cents FROM tb_community_delivery_request WHERE id_delivery=$1`, [deliv.id_delivery]);
    check("chamado da A intacto", dRow.rows[0].status === "open" && dRow.rows[0].price_cents === 500,
      JSON.stringify(dRow.rows[0]));
    r = await call("POST", `/communities/${condo2}/deliveries/${deliv.id_delivery}/cancel`, { token: tB });
    const dRow2 = await pool.query(`SELECT status FROM tb_community_delivery_request WHERE id_delivery=$1`, [deliv.id_delivery]);
    check("B não cancela o chamado da A pela URL do próprio prédio", dRow2.rows[0].status === "open", `veio ${r.status}`);
    r = await call("GET", `/communities/${condo}/deliveries`, { token: tM });
    const seen = (r.body?.deliveries || []).find((d) => d.id_delivery == deliv.id_delivery);
    check("M vê o chamado aberto da A sem o link de pagamento dela", r.status === 200 && seen && seen.checkout_url === undefined,
      `veio ${r.status}`);

    // ═══ 4. pendente do prédio (A1-15, A1-13, A1-14) ═══════════════════
    console.log("\n━━━ 4. quem só reivindicou apartamento ocupado ━━━");
    r = await call("GET", `/communities/${condo}/feed-posts`, { token: tP });
    const leakedFeed = JSON.stringify(r.body || {}).includes(`recado interno ${tag}`);
    check("pendente não lê o mural do prédio (A1-15)", !leakedFeed && (r.body?.locked === true || r.status === 403),
      `veio ${r.status}, recado ${leakedFeed ? "vazou" : "não veio"}`);
    r = await call("GET", `/communities/${condo}/feed`, { token: tP });
    check("pendente não lê o feed do prédio (A1-15)",
      !JSON.stringify(r.body || {}).includes(`recado interno ${tag}`) && (r.body?.locked === true || r.status === 403), `veio ${r.status}`);
    r = await call("GET", `/communities/${condo}/announcements`, { token: tP });
    check("pendente não lê os avisos do prédio (A1-15)", (r.body?.announcements || []).length === 0,
      `veio ${(r.body?.announcements || []).length} avisos`);
    r = await call("GET", `/communities/${condo}/feed-posts`, { token: tM });
    check("morador M lê o mural (controle)", JSON.stringify(r.body || {}).includes(`recado interno ${tag}`), `veio ${r.status}`);
    r = await call("POST", `/communities/${condo}/recado`, { token: tP, body: { body: `recado do pendente ${tag}` } });
    const pRec = await pool.query(
      `SELECT count(*)::int n FROM tb_community_feed_item WHERE id_community_profile=$1 AND body=$2`, [condo, `recado do pendente ${tag}`]
    );
    check("pendente não publica recado no mural (A1-13)", r.status >= 400 && pRec.rows[0].n === 0, `veio ${r.status}`);
    r = await call("POST", `/condos/${condo}/notices/${notice2.id_notice}/read`, { token: tA });
    const rd = await pool.query(`SELECT count(*)::int n FROM tb_condo_notice_read WHERE id_notice=$1 AND id_user=$2`, [notice2.id_notice, A.id_user]);
    check("recibo de leitura de aviso de OUTRO prédio é recusado (A1-14)", r.status === 404 && rd.rows[0].n === 0, `veio ${r.status}`);

    // ═══ 5. mercado local ══════════════════════════════════════════════
    console.log("\n━━━ 5. mercado local ━━━");
    r = await call("GET", `/local-market/report?kind=listing&listing_kind=service&id_community=${condo}`, { token: tB });
    const leakedTitle = JSON.stringify(r.body || {}).toLowerCase().includes(`corte secreto ${tag}`);
    check("B (de fora) não lê os anúncios do prédio pelo relatório (A1-22)", r.status === 403 && !leakedTitle,
      `veio ${r.status}, título ${leakedTitle ? "vazou" : "não veio"}`);
    r = await call("GET", `/local-market/report?kind=listing&listing_kind=service&id_community=${condo}`, { token: tM });
    check("morador M lê o relatório do próprio prédio (controle)", r.status === 200, `veio ${r.status}`);
    r = await call("GET", `/local-market/report?kind=service&id_community=${condo}`, { token: tB });
    check("relatório de serviços de perfis (público) segue aberto", r.status === 200, `veio ${r.status}`);

    // ═══ 6. nascimento (A1-02) ═════════════════════════════════════════
    console.log("\n━━━ 6. nascimento ━━━");
    r = await call("PUT", "/users/me", { token: tB, body: { data_nascimento: "1970-05-05" } });
    const nasc = await pool.query(`SELECT to_char(data_nascimento,'YYYY-MM-DD') d FROM tb_user WHERE id_user=$1`, [B.id_user]);
    check("PUT /users/me não troca a data de nascimento (A1-02)", nasc.rows[0].d === "1990-01-01",
      `veio ${r.status}, data ${nasc.rows[0].d}`);
    r = await call("PUT", "/users/me", { token: tB, body: { bio: "nova bio", data_nascimento: "1990-01-01" } });
    check("a mesma data junto com outro campo salva normalmente", r.status === 200, `veio ${r.status} ${r.body?.error || ""}`);

    // ═══ 7. admin ══════════════════════════════════════════════════════
    console.log("\n━━━ 7. admin do lote → 403 ━━━");
    for (const [m, p] of [
      ["GET", "/admin/community-commerce/settings"], ["GET", "/admin/community-commerce/disputes"],
      ["GET", "/admin/seller-payouts"], ["GET", "/admin/debts/queue"],
      ["GET", "/admin/store/governance"], ["GET", "/admin/store/products/pending"],
      ["GET", "/admin/store/product-categories"], ["GET", "/admin/polens/products"],
      ["GET", "/admin/function-store/products"],
    ]) {
      const rr = await call(m, p, { token: tB });
      check(`${m} ${p} → 403`, rr.status === 403, `veio ${rr.status}`);
    }
  } catch (e) {
    FAIL++;
    console.error("\nERRO:", e);
  } finally {
    if (server) server.close();
    for (const id of communities) {
      await pool.query(`DELETE FROM tb_community_delivery_request WHERE id_community=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM tb_condo_listing WHERE id_condo=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM tb_profile WHERE id_profile=$1`, [id]).catch(() => {});
    }
    for (const u of users) {
      await pool.query(`DELETE FROM tb_profile WHERE id_user=$1`, [u.id_user]).catch(() => {});
      await pool.query(`DELETE FROM tb_user WHERE id_user=$1`, [u.id_user]).catch(() => {});
    }
    for (const f of flagsBefore) {
      await pool.query(`UPDATE tb_feature_flag SET is_enabled=$2 WHERE flag_key=$1`, [f.flag_key, f.is_enabled]).catch(() => {});
    }
    await pool.end().catch(() => {});
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    process.exit(FAIL ? 1 : 0);
  }
})();
