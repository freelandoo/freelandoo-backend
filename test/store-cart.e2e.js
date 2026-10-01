/**
 * COLEÇÕES + CARRINHO DE CONVIDADO (mig 271) — contra o Postgres dentro de
 * transação com ROLLBACK. Seguro para produção PORQUE NÃO EXISTE `COMMIT`
 * NESTE ARQUIVO: o pool que os services usam é trocado no `require.cache` por
 * um embrulho que transforma BEGIN/COMMIT/ROLLBACK em SAVEPOINT.
 *
 * O GATEWAY É DUBLADO: nenhuma preferência é criada no Mercado Pago, nenhuma
 * cobrança, nenhum estorno de verdade.
 *
 *   npm run test:store-cart
 */
require("dotenv").config();
process.env.DATABASE_SSL = "true";
process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (typeof cond === "function" || (cond && typeof cond.then === "function")) {
    FAIL++;
    console.log(`✗ ${label} — condição assíncrona (faça o await antes)`);
    return;
  }
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function one(c, sql, params = []) {
  return (await c.query(sql, params)).rows[0];
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    let sp = 0;
    const nested = {
      async connect() {
        const name = `sp_${++sp}`;
        let open = false;
        return {
          async query(sql, params) {
            const t = typeof sql === "string" ? sql.trim().toUpperCase() : "";
            if (t === "BEGIN") { open = true; return c.query(`SAVEPOINT ${name}`); }
            if (t === "COMMIT") { open = false; return c.query(`RELEASE SAVEPOINT ${name}`); }
            if (t === "ROLLBACK") {
              if (!open) return { rows: [] };
              open = false;
              return c.query(`ROLLBACK TO SAVEPOINT ${name}`);
            }
            return c.query(sql, params);
          },
          release() {},
        };
      },
      query: (...a) => c.query(...a),
      end: async () => {},
    };
    require.cache[require.resolve("../src/databases")].exports = nested;

    // ── o gateway dublado ───────────────────────────────────────────────────
    const gw = { checkouts: [], refunds: [], fee: 300 };
    const payPath = require.resolve("../src/integrations/payments");
    require(payPath);
    const realPay = require.cache[payPath].exports;
    require.cache[payPath].exports = {
      ...realPay,
      async createCheckout(req) {
        gw.checkouts.push(req);
        const id = `fake_pref_${gw.checkouts.length}`;
        return { id, url: `https://mp.test/${id}`, provider: "mercadopago", provider_ref: id };
      },
      async getChargeFee() {
        return { fee_cents: gw.fee, source: "mercadopago_fee", charge_id: null };
      },
      async refund(args) {
        gw.refunds.push(args);
        return { ok: true };
      },
    };

    const StoreCartService = require("../src/services/StoreCartService");
    const ProductCollectionService = require("../src/services/ProductCollectionService");
    const ProfileProductService = require("../src/services/ProfileProductService");
    const ProfileProductOrderService = require("../src/services/ProfileProductOrderService");
    const StripeWebhookService = require("../src/services/StripeWebhookService");
    const SiteTemplates = require("../src/utils/siteTemplates");
    const { validateBuyer, normalizeItems, splitFee } = StoreCartService._internal;

    // ── 1. a migration ──────────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "../src/databases/migrations/271_store_collections_guest_cart.sql"),
      "utf8"
    );
    await c.query(sql);
    await c.query(sql);
    check("migration 271 aplica e é idempotente", true);
    const nn = await one(
      c,
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name='tb_profile_product_order' AND column_name='id_buyer_user'`
    );
    check("pedido aceita comprador convidado (id_buyer_user NULL)", nn.is_nullable === "YES");

    // ── 2. elenco: uma vendedora (perfil-conta) e uma estranha ─────────────
    const stamp = Date.now();
    const cat = await one(c, `SELECT id_category FROM public.tb_category LIMIT 1`);
    const mkUser = async (p) => {
      const u = await one(
        c,
        `INSERT INTO public.tb_user (nome, email, username) VALUES ($1,$2,$3) RETURNING id_user`,
        [p, `${p}${stamp}@t.test`, `${p}${stamp}`]
      );
      const pr = await one(
        c,
        `INSERT INTO public.tb_profile (id_user, sub_profile_slug, display_name, id_category, is_user_account)
         VALUES ($1,$2,$3,$4,TRUE) RETURNING id_profile`,
        [u.id_user, `acc${p}${stamp}`, `Loja ${p}`, cat.id_category]
      );
      return { id_user: u.id_user, id_profile: pr.id_profile };
    };
    const seller = await mkUser("vend");
    const other = await mkUser("outra");
    const sU = { id_user: seller.id_user };

    // ── 3. coleções ─────────────────────────────────────────────────────────
    const c1 = await ProductCollectionService.create(sU, { id_profile: seller.id_profile }, { name: "Chrome Líquido", kicker: "Liquid metal" });
    check("cria coleção com endereço tirado do nome", c1.collection?.slug === "chrome-liquido", JSON.stringify(c1));
    const c2 = await ProductCollectionService.create(sU, { id_profile: seller.id_profile }, { name: "Chrome Líquido" });
    check("nome repetido ganha sufixo, não recusa", c2.collection?.slug === "chrome-liquido-2");
    const cr = await ProductCollectionService.create(sU, { id_profile: seller.id_profile }, { name: "Loja" });
    check("endereço reservado do site é recusado", !!cr.error);
    const foreign = await ProductCollectionService.create({ id_user: other.id_user }, { id_profile: seller.id_profile }, { name: "X" });
    check("estranha não cria coleção na loja dos outros", foreign.statusCode === 403);
    const ren = await ProductCollectionService.update(sU, { id_profile: seller.id_profile, id_collection: c1.collection.id_collection }, { name: "Chrome" });
    check("renomear NÃO muda o endereço", ren.collection?.name === "Chrome" && ren.collection?.slug === "chrome-liquido");
    const clash = await ProductCollectionService.update(sU, { id_profile: seller.id_profile, id_collection: c1.collection.id_collection }, { slug: "chrome-liquido-2" });
    check("endereço já usado → 409", clash.statusCode === 409);

    // ── 4. produtos na coleção ─────────────────────────────────────────────
    const pcat = await one(c, `SELECT id_product_category FROM public.tb_product_category WHERE status='active' LIMIT 1`);
    const mkProduct = async (name, price, stock, extra = {}) => {
      const r = await ProfileProductService.create(sU, { id_profile: seller.id_profile }, {
        name, price_amount: price, stock_quantity: stock, id_product_category: pcat.id_product_category,
        id_collection: c1.collection.id_collection, ...extra,
      });
      if (r.error) throw new Error(`${name}: ${r.error}`);
      return r.product;
    };
    const pA = await mkProduct(`Cherry ${stamp}`, 8000, 5, { is_featured: true });
    const pB = await mkProduct(`Kitten ${stamp}`, 10000, 2);
    check("produto nasce na coleção e com destaque", Number(pA.id_collection) === Number(c1.collection.id_collection) && pA.is_featured === true);

    const otherCol = await ProductCollectionService.create({ id_user: other.id_user }, { id_profile: other.id_profile }, { name: "Alheia" });
    const bad = await ProfileProductService.create(sU, { id_profile: seller.id_profile }, {
      name: "x", price_amount: 100, stock_quantity: 1, id_product_category: pcat.id_product_category,
      id_collection: otherCol.collection.id_collection,
    });
    check("produto não entra em coleção de outra loja", bad.error === "Coleção não encontrada");

    // ── 5. validação pura ──────────────────────────────────────────────────
    check("comprador: e-mail torto recusado", !!validateBuyer({ name: "Ana", email: "ana@", whatsapp: "11999999999" }).error);
    check("comprador: sem WhatsApp recusado", !!validateBuyer({ name: "Ana", email: "a@b.com", whatsapp: "123" }).error);
    check("comprador válido passa", !validateBuyer({ name: "Ana Paula", email: "A@B.com", whatsapp: "(11) 99999-9999" }).error);
    const merged = normalizeItems([{ id_profile_product: 1, quantity: 2 }, { id_profile_product: 1, quantity: 3 }]);
    check("itens repetidos viram uma linha só", merged.items?.length === 1 && merged.items[0].quantity === 5);
    check("quantidade zero recusada", !!normalizeItems([{ id_profile_product: 1, quantity: 0 }]).error);
    const parts = splitFee(301, [{ total_cents: 100 }, { total_cents: 200 }]);
    check("a tarifa repartida fecha exatamente", parts[0] + parts[1] === 301 && parts[0] === 100);

    // ── 6. checkout de convidado ───────────────────────────────────────────
    const buyer = { name: "Ana Convidada", email: "ana@convidada.test", whatsapp: "11988887777" };
    const res = await StoreCartService.createCheckout(null, {
      buyer,
      items: [
        { id_profile_product: pA.id_profile_product, quantity: 2, unit_price_cents: 1 },
        { id_profile_product: pB.id_profile_product, quantity: 1 },
      ],
      return_url: "https://evil.test/roubo",
    });
    check("convidado fecha o carrinho e recebe a página de pagamento", !!res.checkout_url && !!res.id_cart, JSON.stringify(res));
    const cart = await one(c, `SELECT * FROM public.tb_store_cart WHERE id_cart = $1`, [res.id_cart]);
    const orders = (await c.query(`SELECT * FROM public.tb_profile_product_order WHERE id_cart = $1 ORDER BY id_order`, [res.id_cart])).rows;
    const expected = orders.reduce((s, o) => s + Number(o.total_cents), 0);
    check("dois pedidos-filhos, pendentes, sem comprador com conta", orders.length === 2 && orders.every((o) => o.status === "pending" && o.id_buyer_user === null));
    check("o preço vem do banco, nunca do corpo", Number(orders[0].unit_price_cents) > 1 && Number(cart.total_cents) === expected);
    check("o preço cobrado é o de comprador (com taxa), não o da vendedora", Number(orders[0].unit_price_cents) >= 8000 && Number(orders[0].seller_amount_cents) === 16000);
    check("filhos SEM referência de pagamento (mig 271)", orders.every((o) => !o.stripe_session_id && !o.stripe_payment_intent_id));
    check("a sessão mora no carrinho", cart.session_id === "fake_pref_1");
    const sent = gw.checkouts[0];
    check("uma cobrança com dois itens e o total certo", sent.lineItems.length === 2 && sent.amount_cents === Number(cart.total_cents) && sent.flow === "store_cart");
    check("URL de retorno de fora é DESCARTADA", !String(sent.successUrl).includes("evil.test") && String(sent.successUrl).includes(`pedido=${res.id_cart}`));

    const ok2 = await StoreCartService.createCheckout(null, {
      buyer, items: [{ id_profile_product: pA.id_profile_product, quantity: 1 }],
      return_url: "https://pinkoracats.freelandoo.com.br/pagina/loja?x=1",
    });
    const sent2 = gw.checkouts[1];
    check("URL de retorno da plataforma vale (sem a query antiga)", String(sent2.successUrl).startsWith("https://pinkoracats.freelandoo.com.br/pagina/loja?pedido=") && !!ok2.id_cart);

    const tooMany = await StoreCartService.createCheckout(null, { buyer, items: [{ id_profile_product: pB.id_profile_product, quantity: 3 }] });
    check("estoque insuficiente recusa ANTES de cobrar", tooMany.statusCode === 409 && gw.checkouts.length === 2);
    const pOther = (await ProfileProductService.create({ id_user: other.id_user }, { id_profile: other.id_profile }, {
      name: `Alheio ${stamp}`, price_amount: 500, stock_quantity: 3, id_product_category: pcat.id_product_category,
    })).product;
    const mixed = await StoreCartService.createCheckout(null, {
      buyer, items: [{ id_profile_product: pA.id_profile_product, quantity: 1 }, { id_profile_product: pOther.id_profile_product, quantity: 1 }],
    });
    check("carrinho com duas lojas é recusado", !!mixed.error && gw.checkouts.length === 2);
    const own = await StoreCartService.createCheckout(sU, { buyer, items: [{ id_profile_product: pA.id_profile_product, quantity: 1 }] });
    check("vendedora não compra o próprio produto", !!own.error);
    await c.query(`UPDATE public.tb_profile_product SET is_active = FALSE WHERE id_profile_product = $1`, [pOther.id_profile_product]);
    const draft = await StoreCartService.createCheckout(null, { buyer, items: [{ id_profile_product: pOther.id_profile_product, quantity: 1 }] });
    check("rascunho não é comprável", draft.statusCode === 409);

    // ── 7. o webhook confirma ───────────────────────────────────────────────
    const session = { id: cart.session_id, payment_intent: "mp_pay_1", metadata: { type: "store_cart", id_cart: res.id_cart } };
    const conf = await StripeWebhookService.fulfillCheckoutSession(session);
    check("confirmação pelo MESMO caminho do webhook", !!conf?.cart && conf.cart.status === "paid", JSON.stringify(conf));
    const stockA = await one(c, `SELECT stock_quantity FROM public.tb_profile_product WHERE id_profile_product=$1`, [pA.id_profile_product]);
    const stockB = await one(c, `SELECT stock_quantity FROM public.tb_profile_product WHERE id_profile_product=$1`, [pB.id_profile_product]);
    check("o estoque cai só depois do pagamento", stockA.stock_quantity === 3 && stockB.stock_quantity === 1);
    const paidOrders = (await c.query(`SELECT * FROM public.tb_profile_product_order WHERE id_cart=$1 ORDER BY id_order`, [res.id_cart])).rows;
    check("filhos pagos e ainda sem referência", paidOrders.every((o) => o.status === "paid" && !o.stripe_payment_intent_id));
    const fees = paidOrders.reduce((s, o) => s + Number(o.processor_fee_cents), 0);
    check("tarifa real repartida entre os filhos fecha com o gateway", fees === gw.fee && paidOrders.every((o) => o.processor_fee_source === "mercadopago_fee"));
    const bal = (await c.query(`SELECT * FROM public.tb_seller_balance WHERE id_order = ANY($1::bigint[])`, [paidOrders.map((o) => o.id_order)])).rows;
    check("saldo da vendedora com holdback, um por pedido", bal.length === 2 && bal.every((b) => b.status === "aguardando" && new Date(b.available_at) > new Date(Date.now() + 7 * 86400000)));
    check("o líquido é o preço da vendedora", bal.reduce((s, b) => s + Number(b.net_cents), 0) === 16000 + 10000);
    const again = await StoreCartService.confirmStripeSession(session);
    check("reentrega do webhook não confirma duas vezes", again.already === true);
    const stockA2 = await one(c, `SELECT stock_quantity FROM public.tb_profile_product WHERE id_profile_product=$1`, [pA.id_profile_product]);
    check("…e não baixa o estoque de novo", stockA2.stock_quantity === 3);

    // ── 8. recibo público ───────────────────────────────────────────────────
    const pub = await StoreCartService.getPublic({ id_cart: res.id_cart });
    const pubJson = JSON.stringify(pub);
    check("recibo público mostra itens e estado", pub.cart?.status === "paid" && pub.cart.items.length === 2);
    check("recibo NÃO vaza e-mail, WhatsApp nem sobrenome", !pubJson.includes("convidada.test") && !pubJson.includes("988887777") && !pubJson.includes("Convidada"));
    check("recibo de id torto é 404", (await StoreCartService.getPublic({ id_cart: "x" })).statusCode === 404);

    // ── 9. estorno ──────────────────────────────────────────────────────────
    const single = await ProfileProductOrderService.handleChargeRefunded({ payment_intent: "mp_pay_1", amount: 1, amount_refunded: 1, refunded: true });
    check("a Loja avulsa NÃO pega o estorno do carrinho", single.ignored === true);
    const partial = await StoreCartService.handleChargeRefunded({ payment_intent: "mp_pay_1", amount: 100, amount_refunded: 10, refunded: false });
    check("estorno parcial é ignorado", partial.partial === true);
    await StripeWebhookService.dispatchEvent({
      id: `evt_${stamp}`, type: "charge.refunded",
      data: { object: { payment_intent: "mp_pay_1", amount: Number(cart.total_cents), amount_refunded: Number(cart.total_cents), refunded: true } },
    });
    const refCart = await one(c, `SELECT status FROM public.tb_store_cart WHERE id_cart=$1`, [res.id_cart]);
    const stockA3 = await one(c, `SELECT stock_quantity FROM public.tb_profile_product WHERE id_profile_product=$1`, [pA.id_profile_product]);
    const balR = (await c.query(`SELECT status FROM public.tb_seller_balance WHERE id_order = ANY($1::bigint[])`, [paidOrders.map((o) => o.id_order)])).rows;
    check("estorno total pela cadeia do webhook: carrinho reembolsado", refCart.status === "refunded");
    check("…estoque devolvido", stockA3.stock_quantity === 5);
    check("…saldo revertido", balR.every((b) => b.status === "revertido"));
    const dup = await StoreCartService.handleChargeRefunded({ payment_intent: "mp_pay_1", amount: 1, amount_refunded: 1, refunded: true });
    check("estorno repetido não devolve estoque de novo", dup.duplicate === true);

    // ── 10. esgotou entre o checkout e o pagamento ─────────────────────────
    const res3 = await StoreCartService.createCheckout(null, { buyer, items: [{ id_profile_product: pB.id_profile_product, quantity: 2 }] });
    await c.query(`UPDATE public.tb_profile_product SET stock_quantity = 1 WHERE id_profile_product=$1`, [pB.id_profile_product]);
    const cart3 = await one(c, `SELECT * FROM public.tb_store_cart WHERE id_cart=$1`, [res3.id_cart]);
    const before = gw.refunds.length;
    const out = await StripeWebhookService.fulfillCheckoutSession({ id: cart3.session_id, payment_intent: "mp_pay_3", metadata: { type: "store_cart", id_cart: res3.id_cart } });
    const cart3b = await one(c, `SELECT status FROM public.tb_store_cart WHERE id_cart=$1`, [res3.id_cart]);
    const stockB3 = await one(c, `SELECT stock_quantity FROM public.tb_profile_product WHERE id_profile_product=$1`, [pB.id_profile_product]);
    check("esgotado no pagamento: carrinho cancelado", out?.canceled === true && cart3b.status === "canceled");
    check("…estoque intocado e dinheiro devolvido", stockB3.stock_quantity === 1 && gw.refunds.length === before + 1);

    // ── 11. página de pagamento abandonada ─────────────────────────────────
    const res4 = await StoreCartService.createCheckout(null, { buyer, items: [{ id_profile_product: pA.id_profile_product, quantity: 1 }] });
    const cart4 = await one(c, `SELECT session_id FROM public.tb_store_cart WHERE id_cart=$1`, [res4.id_cart]);
    await StripeWebhookService.expireCheckoutSession({ id: cart4.session_id, metadata: { type: "store_cart", id_cart: res4.id_cart } }, "teste");
    const st4 = await one(c, `SELECT status FROM public.tb_store_cart WHERE id_cart=$1`, [res4.id_cart]);
    const o4 = await one(c, `SELECT status FROM public.tb_profile_product_order WHERE id_cart=$1`, [res4.id_cart]);
    check("expirar cancela carrinho e filhos", st4.status === "canceled" && o4.status === "canceled");

    // ── 12. coleção apagada solta os produtos ───────────────────────────────
    await ProductCollectionService.remove(sU, { id_profile: seller.id_profile, id_collection: c1.collection.id_collection });
    const freed = await one(c, `SELECT id_collection, deleted_at FROM public.tb_profile_product WHERE id_profile_product=$1`, [pA.id_profile_product]);
    check("apagar a coleção solta o produto, sem apagá-lo", freed.id_collection === null && freed.deleted_at === null);

    check("o tema pinkoracats pede a Loja ao vivo", SiteTemplates.wantsLiveCatalog("pinkoracats") === true && SiteTemplates.wantsLiveCatalog("enzo-cortes") === false);
  } catch (err) {
    FAIL++;
    console.log("✗ erro inesperado —", err.stack || err.message);
  } finally {
    await c.query("ROLLBACK");
    c.release();
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await new Promise((r) => setTimeout(r, 300));
    process.exit(FAIL ? 1 : 0);
  }
})();
