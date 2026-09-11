const Stripe = require("stripe");

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

// ⚠️ REMOVIDAS por falta de dono: `createAnnualProductAndPrice` (só o script
// scripts/stripe-bootstrap.js a chamava, e ele saiu junto — criava um
// Product/Price no Stripe que NADA lia: `stripe_price_id` é gravado como
// `null` em toda ativação, que cobra por `price_data` ad-hoc) e
// `createSubscriptionCheckoutSession` (zero chamadores). Não recriar.

/**
 * Cria checkout session em modo `subscription` com price_data ad-hoc MENSAL
 * (sem Product/Price no dashboard — mesmo espírito do one-time com price_data).
 * Usado por mensalidade de comunidade privada e bolsa patrocínio. O metadata é
 * replicado em subscription_data.metadata para o webhook conseguir rotear
 * faturas recorrentes (invoice.paid) mesmo sem a checkout session em mãos.
 */
async function createMonthlySubscriptionCheckoutSession({
  amount_cents,
  currency = "BRL",
  productName,
  customerEmail,
  customerId,
  clientReferenceId,
  successUrl,
  cancelUrl,
  metadata,
}) {
  const stripe = client();

  const params = {
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: String(currency).toLowerCase(),
          product_data: { name: productName },
          unit_amount: amount_cents,
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId,
    allow_promotion_codes: false,
    metadata: metadata || {},
    subscription_data: { metadata: metadata || {} },
  };

  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  return stripe.checkout.sessions.create(params);
}

/**
 * Cria checkout session em modo `payment` (one-time) para ATIVAÇÃO do perfil.
 * R$ 300 vitalício — sem renovação. Aceita cupom (promotion code) opcional.
 *
 * Diferente de createOneTimeCheckoutSession (clan), este expõe controle de
 * promotion code e popula payment_intent_data com metadata pra rastreio.
 */
async function createProfileActivationCheckoutSession({
  amount_cents,
  currency = "BRL",
  productName,
  customerEmail,
  customerId,
  clientReferenceId,
  successUrl,
  cancelUrl,
  metadata,
}) {
  const stripe = client();

  // O desconto de cupom é calculado no backend e embutido em `amount_cents`.
  // allow_promotion_codes fica FALSE pra ninguém digitar um código avulso
  // na página do Stripe e furar a validação (cupom próprio, override, etc.).
  const params = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: String(currency).toLowerCase(),
          product_data: { name: productName },
          unit_amount: amount_cents,
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId,
    allow_promotion_codes: false,
    metadata: metadata || {},
    payment_intent_data: { metadata: metadata || {} },
  };

  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  return stripe.checkout.sessions.create(params);
}

/**
 * Cria checkout session em modo `payment` (one-time). Usado para compras
 * pontuais como vagas de clan (R$50 cada).
 */
async function createOneTimeCheckoutSession({
  amount_cents,
  currency = "BRL",
  productName,
  // `description` e `customText` existem para o SINAL DE AGENDAMENTO, que
  // montava a sessão chamando `client()` direto só por causa deles — furando a
  // costura do gateway. Opcionais: quem não manda, sai exatamente como antes.
  description,
  customText,
  customerEmail,
  customerId,
  clientReferenceId,
  successUrl,
  cancelUrl,
  metadata,
}) {
  const stripe = client();

  const params = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: String(currency).toLowerCase(),
          product_data: {
            name: productName,
            ...(description ? { description } : {}),
          },
          unit_amount: amount_cents,
        },
        quantity: 1,
      },
    ],
    ...(customText ? { custom_text: customText } : {}),
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId,
    metadata: metadata || {},
    payment_intent_data: { metadata: metadata || {} },
  };

  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  return stripe.checkout.sessions.create(params);
}

/**
 * Cria checkout session em modo `payment` com múltiplos line items ad-hoc
 * (produto + frete + outros). Usado pela Loja para enviar produto e frete
 * como itens separados.
 */
async function createMultiItemCheckoutSession({
  line_items, // [{ name, amount_cents, quantity }]
  currency = "BRL",
  customerEmail,
  customerId,
  clientReferenceId,
  successUrl,
  cancelUrl,
  metadata,
}) {
  const stripe = client();
  const items = (line_items || []).map((li) => ({
    price_data: {
      currency: String(currency).toLowerCase(),
      product_data: { name: String(li.name).slice(0, 250) },
      unit_amount: Math.max(0, Math.round(Number(li.amount_cents) || 0)),
    },
    quantity: Math.max(1, Number(li.quantity) || 1),
  }));

  const params = {
    mode: "payment",
    line_items: items,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId,
    metadata: metadata || {},
    payment_intent_data: { metadata: metadata || {} },
  };

  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  return stripe.checkout.sessions.create(params);
}

async function retrieveSession(sessionId) {
  return client().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "customer", "total_details.breakdown.discounts"],
  });
}

async function retrieveSubscription(subscriptionId) {
  return client().subscriptions.retrieve(subscriptionId);
}

async function retrieveInvoice(invoiceId) {
  return client().invoices.retrieve(invoiceId);
}

async function retrievePaymentIntent(piId, opts = {}) {
  return client().paymentIntents.retrieve(piId, opts);
}

async function cancelSubscriptionImmediate(stripeSubscriptionId) {
  return client().subscriptions.cancel(stripeSubscriptionId);
}

async function createRefund(chargeId) {
  return client().refunds.create({
    charge: chargeId,
    reason: "requested_by_customer",
  });
}

/**
 * Reembolsa pelo PaymentIntent (sem precisar resolver o charge antes). Usado
 * nos caminhos "pagou mas não recebeu" dos webhooks (estoque esgotado,
 * premium já ativo) — devolve o dinheiro em vez de deixar o pagamento órfão.
 */
async function createRefundForPaymentIntent(paymentIntentId) {
  return client().refunds.create({
    payment_intent: paymentIntentId,
    reason: "requested_by_customer",
  });
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

// ⚠️ As três funções de CUPOM (createCoupon / createPromotionCode /
// deactivatePromotionCode) foram REMOVIDAS. O cupom da plataforma nunca foi
// resolvido pelo provedor: quem calcula o desconto é o CouponDiscountResolver,
// e o valor desce embutido em `amount_cents`. O Asaas não tem cupom — o
// contrato RECUSA `promotionCode` em voz alta, e cunhar um no Stripe deixaria
// um objeto lá que nada aqui consulta. Não recriar.

async function cancelSubscription(stripeSubscriptionId) {
  return client().subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}

// ⚠️ `client` NÃO É MAIS EXPORTADO, e isso é uma TRAVA, não arrumação.
//
// Ele era a escotilha: com o cliente cru na mão, qualquer service falava Stripe
// direto e furava o PaymentGateway — foi por ali que a Loja ficou perguntando a
// taxa só ao Stripe, deixando toda venda do Asaas presa na estimativa. Hoje não
// há um único chamador fora deste arquivo, e mantê-lo exportado seria deixar a
// porta aberta para o próximo atalho.
//
// Precisa de capacidade nova do provedor? Ela entra no CONTRATO
// (integrations/payments/contract.js) e ganha implementação nos DOIS — como
// `getChargeFee` e `getSubscriptionPeriod` ganharam.
module.exports = {
  createProfileActivationCheckoutSession,
  createOneTimeCheckoutSession,
  createMultiItemCheckoutSession,
  createMonthlySubscriptionCheckoutSession,
  retrieveSession,
  retrieveSubscription,
  retrieveInvoice,
  retrievePaymentIntent,
  cancelSubscriptionImmediate,
  createRefund,
  createRefundForPaymentIntent,
  constructWebhookEvent,
  cancelSubscription,
};
