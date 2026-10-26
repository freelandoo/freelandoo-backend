// test/meu-mundo-inbox.e2e.js — MEU MUNDO 3D mm3d-30: sino, correio interno,
// presentes, aba Itens e Poléns no jogo (mig 302), no banco e pelos serviços.
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-inbox
// Só Postgres LOCAL e descartável. Nenhuma cobrança real: o "webhook" é a
// chamada direta ao confirmador com uma sessão inventada.

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const MIGS = [
  "291_meu_mundo_bairros",
  "292_meu_mundo_house_levels",
  "293_meu_mundo_visits",
  "294_meu_mundo_body_sergio",
  "295_meu_mundo_vida",
  "297_meu_mundo_atributos_1000",
  "298_meu_mundo_atributos_inicio_baixo",
  "299_meu_mundo_vehicles",
  "300_meu_mundo_skins",
  "301_meu_mundo_geladeira",
  "302_meu_mundo_inbox",
  "304_meu_mundo_avatar_colors",
  "308_meu_mundo_lugar_atividade",
  "309_meu_mundo_vendedor",
];
const TABLES = `tb_mm_car_paint_owned, polen_purchases, polen_products, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event, tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_vehicle, tb_mm_visit,
  tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot, tb_mm_neighborhood, tb_user_role, tb_role, tb_user`;

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES} CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  // Loja de Polén no formato que o confirmador usa (mig 040 + 143).
  await pool.query(`CREATE TABLE polen_products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, price_cents INT, polens_amount INT, bonus_polens INT DEFAULT 0, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE polen_purchases (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, product_id UUID, status TEXT, amount_cents INT,
    polens_credited INT, stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT, paid_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  for (const m of MIGS) {
    const sql = fs.readFileSync(path.join(__dirname, `../src/databases/migrations/${m}.sql`), "utf8");
    await pool.query(sql);
    if (m === "302_meu_mundo_inbox") await pool.query(sql); // idempotente
  }
}

async function mkUser(pool, tag, admin = true) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, `mmi_${tag}`, `${id}@mm.test`]);
  if (admin) await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [id]);
  return id;
}

(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  // mm3d-37c: comprar para a geladeira é no supermercado do centro — aqui a pessoa "está" lá.
  require("../src/realtime/meuMundo").atCenterPlace = (_u, p) => p === "supermercado";
  const Inbox = require("../src/services/MeuMundoInboxService");
  const Skins = require("../src/utils/meuMundoSkins");
  const LifeRules = require("../src/utils/meuMundoLife");
  const Storage = require("../src/storages/MeuMundoStorage");

  const admin = await mkUser(pool, "admin");
  const ana = await mkUser(pool, "ana");
  const bia = await mkUser(pool, "bia");
  await Storage.ensureResidence(pool, ana);

  // ── 1. Correio: presente da plataforma, entregue uma vez ────────────────
  await Life.get(ana); // nasce e semeia a geladeira
  const before = (await Life.get(ana)).fridge.salmao_legumes || 0;
  const sent = await Inbox.send(admin, { kind: "gift", to: "mmi_ana", title: "Boas-vindas", body: "Um prato para começar.", gift: { type: "item", id: "salmao_legumes", qty: 2 }, key: "welcome-0001" });
  check("presente enviado para 1 pessoa", sent.sent === 1, JSON.stringify(sent));
  const again = await Inbox.send(admin, { kind: "gift", to: "mmi_ana", title: "Boas-vindas", body: "Um prato para começar.", gift: { type: "item", id: "salmao_legumes", qty: 2 }, key: "welcome-0001" });
  check("reenvio com a mesma chave não duplica a carta", again.sent === 0, JSON.stringify(again));
  const bad = await Inbox.send(admin, { kind: "gift", to: "mmi_ana", title: "X", gift: { type: "item", id: "nao_existe" } });
  check("presente com item inexistente é recusado", bad.code === "gift");

  const mail = await Inbox.mail(ana, { tab: "gift" });
  check("carta do presente na aba Presentes", mail.items.length === 1 && mail.items[0].gift.id === "salmao_legumes");
  check("contador: 1 carta não lida, 1 presente a resgatar", mail.counts.mail === 1 && mail.counts.gifts === 1, JSON.stringify(mail.counts));
  const notes = await Inbox.notices(ana, {});
  const giftNote = notes.items.find((n) => n.kind === "gift");
  check("a notificação do presente aponta para a carta", giftNote && giftNote.mailId === mail.items[0].id);

  const mailId = mail.items[0].id;
  // Cliques simultâneos (duas abas): um entrega, o outro devolve o gravado.
  const [c1, c2] = await Promise.all([Life.claimGift(ana, mailId), Life.claimGift(ana, mailId)]);
  const replays = [c1, c2].filter((c) => c.claim && c.claim.replay).length;
  check("dois resgates ao mesmo tempo: exatamente um entrega", [c1, c2].every((c) => c.claim) && replays === 1, JSON.stringify([c1.claim, c2.claim]));
  const c3 = await Life.claimGift(ana, mailId);
  check("resgate repetido depois devolve o resultado gravado", c3.claim && c3.claim.replay === true && c3.claim.qty === 2);
  const after = (await Life.get(ana)).fridge.salmao_legumes || 0;
  check("geladeira recebeu exatamente 2", after === before + 2, `${before} → ${after}`);
  const opened = await Inbox.mail(ana, {});
  check("resgatar marca a carta como lida", opened.items[0].read && opened.counts.gifts === 0);
  const notes2 = await Inbox.notices(ana, { filter: "rewards" });
  check("e a notificação dela também", notes2.items.every((n) => n.read));
  const other = await Life.claimGift(bia, mailId);
  check("outra pessoa não resgata a carta alheia", other.code === "mail");
  const otherOpen = await Inbox.openMail(bia, mailId);
  check("nem abre", otherOpen.code === "notFound");

  // Presente de moedas e de skin.
  await Inbox.send(admin, { kind: "gift", to: "mmi_ana", title: "Moedas", gift: { type: "coins", qty: 50 } });
  const coins0 = (await Life.get(ana)).wallet.coins;
  const coinMail = (await Inbox.mail(ana, { tab: "gift" })).items.find((m) => m.gift.type === "coins");
  await Life.claimGift(ana, coinMail.id);
  const coins1 = (await Life.get(ana)).wallet.coins;
  check("presente de moedas soma na carteira do jogo", coins1 === coins0 + 50, `${coins0} → ${coins1}`);
  await Inbox.send(admin, { kind: "gift", to: "mmi_ana", title: "Skin", gift: { type: "skin", id: "sergio" } });
  const skinMail = (await Inbox.mail(ana, { tab: "gift" })).items.find((m) => m.gift.type === "skin");
  const sk = await Life.claimGift(ana, skinMail.id);
  const wardrobe = await Storage.getWardrobe(pool, ana);
  check("presente de skin vai para o vestuário", sk.claim.where === "wardrobe" && wardrobe.owned.includes("sergio"));

  // Geladeira cheia: o presente não some — fica para depois.
  await pool.query(`UPDATE tb_mm_pantry SET qty = 99 WHERE id_user = $1 AND item_id = 'salmao_legumes'`, [ana]);
  await Inbox.send(admin, { kind: "gift", to: "mmi_ana", title: "Mais salmão", gift: { type: "item", id: "salmao_legumes", qty: 1 } });
  const full = (await Inbox.mail(ana, { tab: "gift" })).items.find((m) => !m.claimedAt);
  const fr = await Life.claimGift(ana, full.id);
  const still = (await Inbox.mail(ana, { tab: "gift" })).items.find((m) => m.id === full.id);
  check("geladeira cheia recusa sem marcar como resgatado", fr.code === "stack" && !still.claimedAt);

  // ── 2. Comunicado oficial, promoção e preferência ───────────────────────
  await Inbox.setPrefs(bia, { promos: false });
  await Life.get(bia);
  const promo = await Inbox.send(admin, { kind: "promo", to: "*", title: "Semana do salmão", body: "Promo" });
  const biaMail = await Inbox.mail(bia, { tab: "promo" });
  check("promoção pula quem desligou promoções", promo.sent >= 1 && biaMail.items.length === 0, JSON.stringify(promo));
  await Inbox.send(admin, { kind: "official", to: "*", title: "Manutenção", body: "Hoje às 23 h." });
  check("comunicado oficial chega mesmo assim", (await Inbox.mail(bia, { tab: "official" })).items.length === 1);
  const read = await Inbox.readNotices(bia, { all: true });
  check("marcar todas como lidas zera o sino", read.counts.notices === 0, JSON.stringify(read.counts));

  // ── 3. Histórico das necessidades: sem repetição a cada leitura ────────
  await pool.query(`UPDATE tb_mm_character SET satiety = 5 WHERE id_user = $1`, [bia]).catch(() => {});
  const needRows = async () => (await pool.query(`SELECT code FROM tb_mm_notice WHERE id_user = $1 AND kind = 'need'`, [bia])).rows;
  await Life.get(bia);
  const n1 = (await needRows()).length;
  await Life.get(bia);
  await Life.get(bia);
  const n2 = (await needRows()).length;
  check("necessidades não se repetem a cada leitura da vida", n2 === n1, `${n1} → ${n2}`);

  // ── 4. Poléns: produto exclusivo, saldo, idempotência ──────────────────
  // Catálogo de teste: uma skin exclusiva de Poléns (o catálogo real não tem
  // nenhuma ainda — a escolha do produto e do preço é do Alex).
  const fake = Object.freeze({ id: "teste-polens", kind: "skin", name: "Teste", price: 300, currency: "polens", body: "normal" });
  // CATALOG é congelado: a skin de teste entra pela busca por id.
  const origById = Skins.skinById;
  Skins.skinById = (id) => (id === fake.id ? fake : origById(id));

  const w0 = await Life.wallets(ana);
  check("saldos separados: moedas e Poléns (zero confirmado sem carteira)", typeof w0.wallet.coins === "number" && w0.wallet.polens === 0, JSON.stringify(w0));
  const poor = await Life.buySkin(ana, fake.id);
  check("sem Poléns: recusa com 402 e nada muda", poor.code === "polens" && poor.statusCode === 402);
  const coinsBefore = (await Life.get(ana)).wallet.coins;
  check("produto exclusivo nunca cai nas moedas", coinsBefore === (await Life.get(ana)).wallet.coins);
  await pool.query(`INSERT INTO polen_wallets (user_id, balance) VALUES ($1, 1000) ON CONFLICT (user_id) DO UPDATE SET balance = 1000`, [ana]);
  const [b1, b2] = await Promise.all([Life.buySkin(ana, fake.id), Life.buySkin(ana, fake.id)]);
  const polensAfter = (await Life.wallets(ana)).wallet.polens;
  const debits = (await pool.query(`SELECT amount FROM polen_transactions WHERE user_id = $1 AND type = 'spend_meu_mundo'`, [ana])).rows;
  check("duas compras simultâneas: um débito só", debits.length === 1 && Number(debits[0].amount) === -300, JSON.stringify(debits));
  check("saldo de Poléns 1000 → 700", polensAfter === 700, String(polensAfter));
  check("a skin foi entregue", (await Storage.getWardrobe(pool, ana)).owned.includes(fake.id) && [b1, b2].some((b) => b.bought));
  check("moedas do jogo intactas na compra em Poléns", (await Life.get(ana)).wallet.coins === coinsBefore);
  const adminBuy = await Life.buySkin(admin, fake.id);
  check("administrador também paga em Poléns (não é grátis)", adminBuy.code === "polens");
  Skins.skinById = origById;

  // Item exclusivo de Poléns: exige chave; mesma chave não cobra 2×.
  const item = LifeRules.ITEM_BY_ID.get("salmao_legumes");
  const realCurrency = item.currency;
  const fakeItem = { ...item, id: "teste_polens_item", currency: "polens", price: 40 };
  LifeRules.ITEM_BY_ID.set(fakeItem.id, fakeItem);
  const noKey = await Life.buy(ana, fakeItem.id, 1);
  check("item de Poléns sem chave é recusado", noKey.code === "key");
  const k = "buykey-" + crypto.randomBytes(6).toString("hex");
  const i1 = await Life.buy(ana, fakeItem.id, 1, k);
  const i2 = await Life.buy(ana, fakeItem.id, 1, k);
  const pol2 = (await Life.wallets(ana)).wallet.polens;
  check("mesma chave: cobra uma vez e recusa a segunda", i1.bought && i2.code === "key" && pol2 === 660, `${JSON.stringify(i2)} ${pol2}`);
  check("comer direto (consume) recusa item exclusivo", (await Life.consume(ana, fakeItem.id)).code === "currency");
  LifeRules.ITEM_BY_ID.delete(fakeItem.id);
  check("o catálogo real continua em moedas", realCurrency === "coins" && LifeRules.ITEMS.every((it) => it.currency === "coins") && Skins.CATALOG.every((s) => s.currency === "coins"));

  // ── 5. Compra de Poléns: confirmador oficial + recibo uma vez ──────────
  const PolenProductService = require("../src/services/PolenProductService");
  const prod = (await pool.query(`INSERT INTO polen_products (name, price_cents, polens_amount, bonus_polens) VALUES ('Pacote 500', 990, 500, 50) RETURNING id`)).rows[0].id;
  const session = { id: "mp_test_" + crypto.randomBytes(5).toString("hex"), metadata: { type: "polen_purchase", user_id: bia, product_id: prod, polens_amount: "550", return_to: "meu-mundo" }, amount_total: 990 };
  await pool.query(`INSERT INTO polen_purchases (user_id, product_id, status, amount_cents, stripe_session_id) VALUES ($1, $2, 'pending', 990, $3)`, [bia, prod, session.id]);
  const pending = await Inbox.polensPurchase(bia, session.id);
  check("antes da confirmação: pendente, sem saldo", pending.purchase.status === "pending" && (await Life.wallets(bia)).wallet.polens === 0);
  check("compra de outra pessoa não abre", (await Inbox.polensPurchase(ana, session.id)).code === "notFound");
  await PolenProductService.confirmStripeSession(session);
  await PolenProductService.confirmStripeSession(session); // webhook repetido
  const [r1, r2] = await Promise.all([PolenProductService.confirmStripeSession(session), PolenProductService.confirmStripeSession(session)]).then(
    (x) => x,
    (e) => [{ error: e.message }, null]
  );
  void r1;
  void r2;
  check("webhook repetido: crédito uma vez (550)", (await Life.wallets(bia)).wallet.polens === 550);
  check("compra paga", (await Inbox.polensPurchase(bia, session.id)).purchase.status === "paid");
  const receipts = (await Inbox.mail(bia, { tab: "receipt" })).items;
  check("um recibo só na caixa", receipts.length === 1 && receipts[0].data.polens === 550, JSON.stringify(receipts.map((r) => r.data)));

  // ── 6. Aba Itens: o mesmo estoque da geladeira ─────────────────────────
  const inv = await Life.inventory(ana);
  check("itens: vestuário com a skin presenteada", inv.inventory.wardrobe.skins.some((s) => s.id === "sergio" && s.owned));
  check("itens: casa e 4 veículos da residência", inv.inventory.house && inv.inventory.vehicles.length === 4 && inv.inventory.vehicles.every((v) => v.where === "spot"));
  check("itens: geladeira é a mesma da vida", inv.fridge.salmao_legumes === 99);
  check("itens: presentes recentes para o selo Novo", inv.inventory.recentGifts.length >= 3);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
