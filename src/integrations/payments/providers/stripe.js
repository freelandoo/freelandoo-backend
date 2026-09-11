// src/integrations/payments/providers/stripe.js
// O Stripe falando a língua do contrato.
//
// ─── ESTE ARQUIVO NÃO MUDA COMPORTAMENTO NENHUM ─────────────────────────────
//
// Ele é uma TRADUÇÃO: recebe o request do contrato e escolhe qual das funções
// que já existiam no StripeService chamar. Nenhum parâmetro novo chega ao
// Stripe, nenhum deixa de chegar.
//
// Isso é deliberado e é o que torna a migração reversível: enquanto o Asaas
// estiver sendo testado, virar a chave de volta para `stripe` devolve
// exatamente o comportamento de antes do adapter existir.
//
// ⚠️ DEVOLVE A SESSION INTEIRA, e não só `{id, url}`. Há chamadores que leem
// `session.customer` (a ativação de perfil grava `stripe_customer_id`) e
// `session.subscription`. Devolver um objeto enxuto apagaria esses campos em
// silêncio — o pedido nasceria sem o cliente, e o vínculo só faltaria muito
// depois, na hora de reembolsar.

const StripeService = require("../../../services/StripeService");

const PROVIDER = "stripe";

/** O Stripe entende todos os campos do contrato — nada a recusar. */
const UNSUPPORTED_FIELDS = Object.freeze([]);

async function createCheckout(req) {
  const common = {
    amount_cents: req.amount_cents,
    currency: req.currency || "BRL",
    productName: req.productName,
    description: req.description,
    customText: req.customText,
    customerEmail: req.customerEmail,
    customerId: req.customerId,
    clientReferenceId: req.clientReferenceId,
    successUrl: req.successUrl,
    cancelUrl: req.cancelUrl,
    metadata: req.payload || {},
  };

  // Mais de um item (produto + frete) tem função própria: o Stripe mostra as
  // linhas separadas na página de pagamento, e juntar tudo num item só
  // esconderia o frete de quem está comprando.
  if (Array.isArray(req.lineItems) && req.lineItems.length > 0) {
    return StripeService.createMultiItemCheckoutSession({
      line_items: req.lineItems,
      currency: common.currency,
      customerEmail: common.customerEmail,
      customerId: common.customerId,
      clientReferenceId: common.clientReferenceId,
      successUrl: common.successUrl,
      cancelUrl: common.cancelUrl,
      metadata: common.metadata,
    });
  }

  if (req.recurring) {
    return StripeService.createMonthlySubscriptionCheckoutSession(common);
  }

  // `allowPromotionCodes === false` é o caminho da ATIVAÇÃO: o desconto do
  // cupom já foi calculado no backend e embutido no valor, então o campo de
  // cupom da página do Stripe fica fechado — senão dava para digitar um código
  // avulso por cima e furar a validação do cupom próprio.
  if (req.allowPromotionCodes === false) {
    return StripeService.createProfileActivationCheckoutSession(common);
  }

  return StripeService.createOneTimeCheckoutSession(common);
}

function refund({ provider_ref, payment_intent_id }) {
  if (payment_intent_id) {
    return StripeService.createRefundForPaymentIntent(payment_intent_id);
  }
  return StripeService.createRefund(provider_ref);
}

/** No Stripe "cancelar" tem dois sentidos, e a diferença é um mês de acesso. */
function cancelSubscription(subscriptionId, { immediate = false } = {}) {
  return immediate
    ? StripeService.cancelSubscriptionImmediate(subscriptionId)
    : StripeService.cancelSubscription(subscriptionId);
}

/**
 * A janela do ciclo vigente. No Stripe ela vem pronta na assinatura.
 */
async function getSubscriptionPeriod(subscriptionId) {
  const sub = await StripeService.retrieveSubscription(subscriptionId);
  const toDate = (s) => (Number.isFinite(s) ? new Date(s * 1000) : null);
  return {
    period_start: toDate(sub?.current_period_start),
    period_end: toDate(sub?.current_period_end),
  };
}

module.exports = {
  PROVIDER,
  UNSUPPORTED_FIELDS,
  createCheckout,
  refund,
  cancelSubscription,
  getSubscriptionPeriod,
};
