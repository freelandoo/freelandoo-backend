const pool = require("../databases");
const PolenProductStorage = require("../storages/PolenProductStorage");
const PolenStorage = require("../storages/PolenStorage");
const StripeService = require("./StripeService");
const uploadPolenProductImageToR2 = require("../integrations/r2/uploadPolenProductImage");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PolenProductService");

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

class PolenProductService {
  // ---------- Public ----------

  static async listPublic() {
    return runWithLogs(log, "listPublic", () => ({}), async () => {
      const products = await PolenProductStorage.listProducts(pool, { onlyActive: true });
      return { products };
    });
  }

  static async getPublic(id) {
    return runWithLogs(log, "getPublic", () => ({ id }), async () => {
      if (!id) return { error: "id obrigatório" };
      const product = await PolenProductStorage.getProductById(pool, id);
      if (!product || !product.is_active) return { error: "Produto não encontrado" };
      return { product };
    });
  }

  // ---------- Admin ----------

  static async adminListProducts() {
    return { products: await PolenProductStorage.listProducts(pool) };
  }

  static async adminGetProduct(id) {
    const product = await PolenProductStorage.getProductById(pool, id);
    if (!product) return { error: "Produto não encontrado" };
    return { product };
  }

  static async adminCreateProduct(body, file) {
    return runWithLogs(log, "adminCreateProduct", () => ({ name: body?.name }), async () => {
      const name = sanitizeText(body?.name, 160);
      if (!name) return { error: "name obrigatório" };

      const price_cents = clampInt(body?.price_cents, { min: 1, fallback: 0 });
      if (price_cents <= 0) return { error: "price_cents deve ser maior que zero" };

      const polens_amount = clampInt(body?.polens_amount, { min: 1, fallback: 0 });
      if (polens_amount <= 0) return { error: "polens_amount deve ser maior que zero" };

      let image_url = sanitizeText(body?.image_url, 600);
      if (file?.buffer) {
        image_url = await uploadPolenProductImageToR2({ file });
      }

      const data = {
        name,
        description: sanitizeText(body?.description, 2000),
        image_url,
        price_cents,
        polens_amount,
        bonus_polens: clampInt(body?.bonus_polens, { fallback: 0 }),
        is_active: body?.is_active !== false && body?.is_active !== "false",
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      };

      const product = await PolenProductStorage.createProduct(pool, data);
      return { product };
    });
  }

  static async adminUpdateProduct(id, body, file) {
    return runWithLogs(log, "adminUpdateProduct", () => ({ id }), async () => {
      const existing = await PolenProductStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };

      const patch = {};
      if (body?.name !== undefined) {
        const v = sanitizeText(body.name, 160);
        if (!v) return { error: "name inválido" };
        patch.name = v;
      }
      if (body?.description !== undefined) patch.description = sanitizeText(body.description, 2000);
      if (body?.price_cents !== undefined) {
        const v = clampInt(body.price_cents, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "price_cents deve ser maior que zero" };
        patch.price_cents = v;
      }
      if (body?.polens_amount !== undefined) {
        const v = clampInt(body.polens_amount, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "polens_amount deve ser maior que zero" };
        patch.polens_amount = v;
      }
      if (body?.bonus_polens !== undefined) patch.bonus_polens = clampInt(body.bonus_polens);
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      if (body?.is_active !== undefined) {
        patch.is_active = body.is_active === true || body.is_active === "true";
      }

      if (file?.buffer) {
        patch.image_url = await uploadPolenProductImageToR2({ file });
      } else if (body?.image_url !== undefined) {
        patch.image_url = sanitizeText(body.image_url, 600);
      }

      const product = await PolenProductStorage.updateProduct(pool, id, patch);
      return { product };
    });
  }

  static async adminDeleteProduct(id) {
    return runWithLogs(log, "adminDeleteProduct", () => ({ id }), async () => {
      const existing = await PolenProductStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };
      const product = await PolenProductStorage.deleteProduct(pool, id);
      return { product };
    });
  }

  // ---------- Stripe checkout (público autenticado) ----------

  static async createStripeCheckout(user, body = {}) {
    return runWithLogs(log, "createStripeCheckout", () => ({
      id_user: user?.id_user,
      product_id: body?.product_id,
    }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const product = await PolenProductStorage.getProductById(pool, body.product_id);
      if (!product || !product.is_active) return { error: "Produto não encontrado" };

      const amount = Number(product.price_cents) || 0;
      if (amount <= 0) return { error: "Produto sem preço configurado" };

      const totalPolens = (Number(product.polens_amount) || 0) + (Number(product.bonus_polens) || 0);
      if (totalPolens <= 0) return { error: "Produto sem Poléns configurados" };

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const session = await StripeService.createOneTimeCheckoutSession({
        amount_cents: amount,
        currency: "BRL",
        productName: `Loja de Polén - ${product.name}`,
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/loja-polens?polens_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/loja-polens?polens_checkout=cancel`,
        metadata: {
          type: "polen_purchase",
          user_id: user.id_user,
          product_id: product.id,
          polens_amount: String(totalPolens),
          ...(body.coupon_code ? { coupon_code: String(body.coupon_code).trim().toUpperCase().slice(0, 40) } : {}),
        },
      });

      // Reserva pendente (idempotência via UNIQUE em stripe_session_id).
      await PolenProductStorage.createPurchase(pool, {
        user_id: user.id_user,
        product_id: product.id,
        status: "pending",
        amount_cents: amount,
        stripe_session_id: session.id,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "polen_purchase") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await PolenProductStorage.getPurchaseByStripeSession(client, session.id);
      if (existing && existing.status === "paid") {
        await client.query("COMMIT");
        return { purchase: existing, duplicate: true };
      }

      const product = await PolenProductStorage.getProductById(client, meta.product_id);
      if (!product) {
        await client.query("ROLLBACK");
        return { error: "Produto não encontrado" };
      }

      const polensCredit = Number(meta.polens_amount)
        || ((Number(product.polens_amount) || 0) + (Number(product.bonus_polens) || 0));
      if (polensCredit <= 0) {
        await client.query("ROLLBACK");
        return { error: "Quantidade de Poléns inválida" };
      }

      const wallet = await PolenStorage.getOrCreateWallet(client, meta.user_id);
      const paymentIntent = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

      const credit = await PolenStorage.credit(client, {
        user_id: meta.user_id,
        wallet_id: wallet.id,
        amount: polensCredit,
        type: "earn_purchase_stripe",
        source: "polen_shop",
        source_id: session.id,
        metadata: { product_id: product.id, product_name: product.name },
      });

      let purchase = existing;
      if (existing) {
        purchase = await PolenProductStorage.markPurchasePaid(client, existing.id, {
          polens_credited: polensCredit,
          stripe_payment_intent: paymentIntent,
        });
      } else {
        const created = await PolenProductStorage.createPurchase(client, {
          user_id: meta.user_id,
          product_id: product.id,
          status: "pending",
          amount_cents: session.amount_total ?? product.price_cents,
          stripe_session_id: session.id,
        });
        purchase = await PolenProductStorage.markPurchasePaid(client, created.id, {
          polens_credited: polensCredit,
          stripe_payment_intent: paymentIntent,
        });
      }

      await client.query("COMMIT");
      return { purchase, wallet: credit.wallet, transaction: credit.transaction };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const purchase = await PolenProductStorage.getPurchaseByPaymentIntent(pool, paymentIntentId);
    if (!purchase) return { ignored: true };
    if (purchase.status === "refunded") return { purchase, duplicate: true };
    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", {
        purchase_id: purchase.id,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
      });
      return { partial: true };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const credited = Number(purchase.polens_credited) || 0;
      let reversal = null;
      if (credited > 0) {
        const wallet = await PolenStorage.getOrCreateWallet(client, purchase.user_id);
        reversal = await PolenStorage.reverseCredit(client, {
          user_id: purchase.user_id,
          wallet_id: wallet.id,
          amount: credited,
          source: "polen_purchase_refund",
          source_id: String(purchase.id),
          metadata: {
            purchase_id: purchase.id,
            product_id: purchase.product_id,
            stripe_payment_intent: paymentIntentId,
            stripe_charge_id: charge.id || null,
            amount_refunded: charge.amount_refunded || null,
          },
        });
      }
      const updated = await PolenProductStorage.markPurchaseRefunded(client, purchase.id);
      await client.query("COMMIT");
      return { purchase: updated, reversal };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async adminUploadImage(file) {
    return runWithLogs(log, "adminUploadImage", () => ({ name: file?.originalname }), async () => {
      if (!file?.buffer) return { error: "Arquivo obrigatório" };
      const url = await uploadPolenProductImageToR2({ file });
      return { url };
    });
  }
}

module.exports = PolenProductService;
