const Stripe = require("stripe");
const { createLogger } = require("../utils/logger");

const log = createLogger("StripeService");

let _client = null;
function client() {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY não configurado");
  }
  _client = new Stripe(key, { apiVersion: "2024-06-20" });
  return _client;
}

/**
 * Cria Product + Price recorrente anual em BRL. Usado no bootstrap.
 */
async function createAnnualProductAndPrice({ amount_cents, currency = "BRL", name = "Freelandoo — Anuidade" }) {
  const stripe = client();
  const product = await stripe.products.create({ name });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount_cents,
    currency: String(currency).toLowerCase(),
    recurring: { interval: "year" },
  });
  log.info("bootstrap.created", { productId: product.id, priceId: price.id });
  return { product, price };
}

/**
 * Cria uma checkout session em modo subscription. Se `promotionCode` vier,
 * pré-aplica o código; caso contrário deixa o campo de cupom visível.
 */
async function createSubscriptionCheckoutSession({
  priceId,
  customerId,
  customerEmail,
  clientReferenceId,
  successUrl,
  cancelUrl,
  promotionCode,
  metadata,
}) {
  const stripe = client();

  const params = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId,
    allow_promotion_codes: promotionCode ? undefined : true,
    metadata: metadata || {},
    subscription_data: { metadata: metadata || {} },
  };

  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  if (promotionCode) {
    params.discounts = [{ promotion_code: promotionCode }];
  }

  const session = await stripe.checkout.sessions.create(params);
  return session;
}

async function retrieveSession(sessionId) {
  return client().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "customer", "total_details.breakdown.discounts"],
  });
}

async function retrieveSubscription(subscriptionId) {
  return client().subscriptions.retrieve(subscriptionId);
}

/**
 * Verifica a assinatura do webhook e devolve o evento parseado.
 * `rawBody` deve ser Buffer (express.raw).
 */
function constructWebhookEvent(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET não configurado");
  }
  return client().webhooks.constructEvent(rawBody, signature, secret);
}

// ─────────── Coupons / Promotion codes (sync com cupom interno) ───────────

async function createCoupon({ discount_type, discount_value, max_redemptions, expires_at, name }) {
  const stripe = client();
  const params = { name, duration: "once" };
  if (discount_type === "percent") {
    params.percent_off = Number(discount_value);
  } else {
    params.amount_off = Math.round(Number(discount_value));
    params.currency = "brl";
  }
  if (max_redemptions) params.max_redemptions = Number(max_redemptions);
  if (expires_at) {
    const redeemBy = Math.floor(new Date(expires_at).getTime() / 1000);
    if (Number.isFinite(redeemBy)) params.redeem_by = redeemBy;
  }
  return stripe.coupons.create(params);
}

async function createPromotionCode({ coupon, code, expires_at, max_redemptions }) {
  const stripe = client();
  const params = { coupon, code };
  if (max_redemptions) params.max_redemptions = Number(max_redemptions);
  if (expires_at) {
    const expiresEpoch = Math.floor(new Date(expires_at).getTime() / 1000);
    if (Number.isFinite(expiresEpoch)) params.expires_at = expiresEpoch;
  }
  return stripe.promotionCodes.create(params);
}

async function deactivatePromotionCode(promotionCodeId) {
  try {
    return await client().promotionCodes.update(promotionCodeId, { active: false });
  } catch (err) {
    log.warn("deactivatePromotionCode.fail", { promotionCodeId, message: err?.message });
    return null;
  }
}

async function cancelSubscription(stripeSubscriptionId) {
  return client().subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}

module.exports = {
  client,
  createAnnualProductAndPrice,
  createSubscriptionCheckoutSession,
  retrieveSession,
  retrieveSubscription,
  constructWebhookEvent,
  createCoupon,
  createPromotionCode,
  deactivatePromotionCode,
  cancelSubscription,
};
