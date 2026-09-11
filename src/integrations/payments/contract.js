// src/integrations/payments/contract.js
//
// O CONTRATO que todo provedor de pagamento tem que cumprir. É o único lugar
// que descreve o formato — cada provedor traduz o dele para cá.
//
// ─── POR QUE UM CONTRATO, E NÃO "TROCAR A LIB" ──────────────────────────────
//
// Stripe e Asaas não são a mesma API com nomes diferentes. O Stripe tem
// Checkout Session (um objeto que existe só para hospedar o pagamento) e um
// mapa de metadata arbitrário. O Asaas tem `payment` (a cobrança em si), uma
// `invoiceUrl` para pagar, e um `externalReference` que é UMA STRING.
//
// Trocar `require("stripe")` por `require("asaas")` num arquivo só não
// funcionaria: os 20 pontos que criam cobrança hoje falam a língua do Stripe —
// pedem `price_data`, leem `session.payment_intent`, mandam `metadata`. O
// contrato é o que dá a eles uma língua que os dois provedores falam.
//
// ─── O QUE ENTRA NO CONTRATO E O QUE FICA DE FORA ───────────────────────────
//
// ENTRA o que os dois sabem fazer: cobrar um valor, hospedar uma página de
// pagamento, devolver uma referência, reembolsar, cancelar assinatura.
//
// FICA DE FORA o que só um sabe. `promotionCode` é o exemplo: o Asaas não tem
// cupom nenhum, e fingir que tem — aceitando o campo e ignorando — produziria
// um desconto que o comprador viu na tela e não saiu na fatura. O campo é
// declarado como `stripeOnly` e o provedor Asaas RECUSA em voz alta se alguém
// mandar, em vez de cobrar o valor cheio calado.

/**
 * @typedef {Object} CheckoutRequest
 * @property {string}  flow            Chave de utils/paymentFlows (obrigatória).
 * @property {string=} id_user         Quem paga. Vai para a intenção.
 * @property {Object=} payload         O antigo `metadata`: o que a cobrança significa.
 * @property {number}  amount_cents    Valor total, em centavos.
 * @property {string=} currency        Default BRL.
 * @property {string=} productName     Nome mostrado na página de pagamento.
 * @property {Array=}  lineItems       [{ name, amount_cents, quantity }] — quando há mais de um item.
 * @property {string=} customerEmail
 * @property {string=} customerId      Id do cliente NO PROVEDOR (não é o id_user).
 * @property {string=} clientReferenceId
 * @property {string}  successUrl
 * @property {string}  cancelUrl
 * @property {string=} promotionCode   stripeOnly.
 * @property {boolean=} allowPromotionCodes stripeOnly.
 */

/**
 * @typedef {Object} CheckoutResult
 * @property {string}  id           Referência da cobrança no provedor.
 * @property {string}  url          Para onde mandar o navegador.
 * @property {string}  provider
 * @property {string=} intent_id    Id da linha em tb_payment_intent.
 * @property {string=} customer_id
 */

/** Campos que só o Stripe entende. O provedor que não os suporta RECUSA. */
const STRIPE_ONLY_FIELDS = Object.freeze(["promotionCode", "allowPromotionCodes"]);

/**
 * Estados normalizados de uma cobrança, iguais para os dois provedores.
 *
 * ⚠️ `paid` e `confirmed` são coisas diferentes e a diferença é dinheiro. No
 * Asaas, PAYMENT_CONFIRMED é "o cliente pagou" e PAYMENT_RECEIVED é "o dinheiro
 * caiu na conta" — num boleto isso pode levar dias. Entregar o produto em
 * `confirmed` é a escolha certa (o cliente pagou, não pode esperar), mas
 * liberar REPASSE para o vendedor em `confirmed` seria pagar com dinheiro que
 * ainda não existe. Por isso os dois estados são distintos aqui.
 */
const CHARGE_STATUS = Object.freeze({
  PENDING: "pending",
  CONFIRMED: "confirmed",
  RECEIVED: "received",
  REFUNDED: "refunded",
  CANCELED: "canceled",
  FAILED: "failed",
});

/**
 * Evento de webhook normalizado. É o que o roteador de confirmação consome,
 * sem saber de qual provedor veio.
 *
 * @typedef {Object} NormalizedEvent
 * @property {string}  provider
 * @property {string}  event_id      Chave de dedupe (at-least-once nos dois).
 * @property {string}  event_type    Tipo cru do provedor, para telemetria.
 * @property {string}  kind          Um de EVENT_KIND.
 * @property {string=} intent_id     Recuperado do externalReference / metadata.
 * @property {string=} provider_ref  Id da cobrança no provedor.
 * @property {Object}  raw           Payload cru, para auditoria.
 */
const EVENT_KIND = Object.freeze({
  CHECKOUT_PAID: "checkout_paid",
  CHECKOUT_EXPIRED: "checkout_expired",
  CHECKOUT_FAILED: "checkout_failed",
  REFUNDED: "refunded",
  SUBSCRIPTION_PAID: "subscription_paid",
  SUBSCRIPTION_PAYMENT_FAILED: "subscription_payment_failed",
  SUBSCRIPTION_ENDED: "subscription_ended",
  IGNORED: "ignored",
});

/**
 * Recusa campo de provedor errado ANTES da cobrança existir.
 *
 * ⚠️ Falhar aqui devolve erro para quem clicou, com o dinheiro no bolso dele.
 * Ignorar o campo cobraria o valor cheio de alguém que viu um desconto.
 */
function assertNoUnsupportedFields(req, unsupported, providerName) {
  for (const field of unsupported) {
    const v = req?.[field];
    if (v === undefined || v === null || v === false) continue;
    throw new Error(
      `${providerName} não suporta "${field}" — o desconto precisa ser calculado no backend e embutido em amount_cents`
    );
  }
}

/**
 * De qual provedor é este objeto (session, invoice, charge)?
 *
 * ⚠️ A AUSÊNCIA SIGNIFICA STRIPE, e não "desconhecido" — pela mesma razão de
 * `resolveProviderByRef`: o objeto CRU do Stripe não tem campo `provider`
 * nenhum, enquanto tudo que a reidratação do Asaas monta carimba o dele. É essa
 * assimetria que permite gravar a verdade em `payment_provider` sem que o
 * caminho do Stripe precise mudar uma linha.
 */
function providerOf(obj) {
  const p = obj && typeof obj.provider === "string" ? obj.provider.trim().toLowerCase() : "";
  return p || "stripe";
}

module.exports = {
  STRIPE_ONLY_FIELDS,
  CHARGE_STATUS,
  EVENT_KIND,
  assertNoUnsupportedFields,
  providerOf,
};
