// src/services/MercadoPagoWebhookService.js
// O webhook do Mercado Pago — e a REIDRATAÇÃO que faz os ~20 fluxos migrarem
// sem reescrever os ~20 confirmadores.
//
// ─── A IDEIA CENTRAL (a mesma que a migração do Asaas provou) ───────────────
//
// Os confirmadores (`confirmStripeSession`) leem um punhado pequeno de campos
// de uma Checkout Session: `id`, `metadata`, `payment_intent`, `amount_total`,
// `customer`, `subscription`. Nenhum deles fala com o Stripe — todos falam com
// esse OBJETO.
//
// Então este webhook não precisa de ~20 confirmadores novos: precisa montar um
// objeto com essa forma a partir da nossa intenção (mig 231) e entregá-lo ao
// MESMO `fulfillCheckoutSession`.
//
// ⚠️ ISSO NÃO É TRUQUE DE COMPATIBILIDADE — é o que impede as duas verdades.
// Vinte confirmadores paralelos, um por provedor, divergiriam na primeira regra
// de negócio nova (um desconto, um holdback, uma comissão), e a divergência
// apareceria como dinheiro entregue de um jeito num provedor e de outro no
// outro, sem erro nenhum.
//
// ─── ⚠️ A DIFERENÇA QUE CUSTA UMA IDA À REDE: O AVISO É MAGRO ───────────────
//
// O Asaas mandava a cobrança INTEIRA no corpo do evento. O Mercado Pago manda
// só `{ type, action, data: { id } }` — o id do recurso e nada mais. Status,
// valor e `external_reference` só existem depois de um GET.
//
// Consequências que o desenho tem que absorver:
//
//   * cada evento custa uma chamada à API. Não há como evitar.
//   * se a API estiver fora no momento do aviso, o evento NÃO PODE ser dado
//     como tratado — ele tem que falhar para o Mercado Pago re-entregar. É por
//     isso que só o caminho "não sei ler este recurso" devolve `ignored`, e
//     falha de rede sobe como erro.

const pool = require("../databases");
const PaymentIntentStorage = require("../storages/PaymentIntentStorage");
const StripeWebhookEventStorage = require("../storages/StripeWebhookEventStorage");
const StripeWebhookService = require("./StripeWebhookService");
const mp = require("../integrations/payments/mercadoPagoClient");
const { EVENT_KIND } = require("../integrations/payments/contract");
const { createLogger } = require("../utils/logger");

const log = createLogger("MercadoPagoWebhookService");

const PROVIDER = "mercadopago";

/**
 * Status do pagamento → o que fazer.
 *
 * ⚠️ `rejected` NÃO EXPIRA O PEDIDO, e essa é a decisão menos óbvia daqui.
 *
 * No Stripe, o que cancela um pedido pendente é `checkout.session.expired` — a
 * PÁGINA morreu. No Mercado Pago, `rejected` é uma TENTATIVA recusada (cartão
 * negado), e a preferência continua viva: a pessoa volta e paga com outro
 * cartão. Tratar isso como expiração cancelaria — e, na Loja, devolveria ao
 * estoque — um pedido que a pessoa está justamente tentando pagar.
 *
 * Quem limpa pedido abandonado é o radar de presos do `PaymentOpsStorage`, que
 * já existe e mede por TEMPO, que é a régua certa para abandono.
 *
 * ⚠️ `charged_back` entra junto de `refunded` porque o efeito no nosso lado é o
 * mesmo — o dinheiro saiu. Nem o Stripe nem o Asaas tratam disputa hoje, e esta
 * é a primeira vez que a plataforma reage a uma: está anotado como ganho, não
 * como paridade.
 */
const STATUS_KIND = Object.freeze({
  approved: EVENT_KIND.CHECKOUT_PAID,
  refunded: EVENT_KIND.REFUNDED,
  charged_back: EVENT_KIND.REFUNDED,
  cancelled: EVENT_KIND.CHECKOUT_EXPIRED,
});

function kindOfPaymentStatus(status) {
  return STATUS_KIND[String(status || "").toLowerCase()] || EVENT_KIND.IGNORED;
}

/**
 * Acha a intenção a partir da cobrança, em cascata.
 *
 * ⚠️ O `external_reference` é o fio principal — ele carrega o id da intenção
 * desde a criação da preferência. O segundo salto existe para a RE-ENTREGA:
 * depois do primeiro evento, `provider_ref` já foi re-carimbado com o id do
 * payment, então o mesmo aviso chegando de novo ainda encontra a linha.
 */
async function findIntentForPayment(payment) {
  const externalRef = payment && payment.external_reference;
  if (externalRef) {
    const byRef = await PaymentIntentStorage.getById(pool, externalRef).catch(() => null);
    if (byRef) return byRef;
  }
  if (payment && payment.id) {
    const byPayment = await PaymentIntentStorage.getByProviderRef(
      pool,
      PROVIDER,
      String(payment.id)
    );
    if (byPayment) return byPayment;
  }
  return null;
}

/**
 * ⚠️ O RE-CARIMBO É LOAD-BEARING DUAS VEZES, e sem ele o estorno vai para o
 * gateway errado.
 *
 * `provider_ref` nasce com o id da PREFERÊNCIA (o payment não existia ainda).
 * Se ficar assim:
 *
 *   1. `PaymentGateway.refund({ intent_id })` mandaria o id de uma preferência
 *      para `POST /v1/payments/{id}/refunds` → 404, dinheiro não volta.
 *   2. `resolveProviderByRef(payment_id)` não acharia intenção nenhuma e
 *      devolveria **"stripe"** (a ausência significa Stripe, pela regra da mig
 *      231) — o estorno iria para o Stripe, que responde "não encontrado", e o
 *      dinheiro ficaria com a gente.
 *
 * `attachProviderRef` não serve aqui: ele só grava enquanto o campo é NULL, de
 * propósito (protege contra retry na criação). Este caminho SOBRESCREVE.
 */
async function restampProviderRef(intent, payment) {
  const paymentId = payment && payment.id ? String(payment.id) : null;
  if (!paymentId || intent.provider_ref === paymentId) return;
  try {
    await PaymentIntentStorage.setProviderRef(pool, intent.id_payment_intent, paymentId);
  } catch (err) {
    // Não derruba a entrega: o produto precisa ser liberado. Mas é WARN alto —
    // um estorno futuro desta cobrança vai falhar até isso ser corrigido.
    log.warn("provider_ref.restamp_fail", {
      intent_id: intent.id_payment_intent,
      payment_id: paymentId,
      message: err && err.message,
    });
  }
}

/**
 * A "Checkout Session" que os confirmadores esperam.
 *
 * ⚠️ `id` é o da INTENÇÃO, não o do Mercado Pago — é esse valor que foi gravado
 * como `stripe_session_id` na criação, e é por ele que cada confirmador acha o
 * pedido. Usar o id do gateway aqui faria todos responderem "não encontrado" e
 * o pagamento ficaria cobrado e sem entrega.
 */
function buildSessionLike(intent, payment) {
  const paymentId = payment && payment.id ? String(payment.id) : null;
  return {
    id: intent.id_payment_intent,
    object: "checkout.session",
    provider: PROVIDER,
    metadata: intent.payload || {},
    client_reference_id: intent.id_user || null,
    // No Mercado Pago o papel do PaymentIntent do Stripe é do próprio payment:
    // é o id que o estorno recebe, e é ele que os pedidos gravam.
    payment_intent: paymentId || intent.provider_ref || null,
    amount_total:
      Number(intent.amount_cents) ||
      mp.reaisToCents(payment && payment.transaction_amount),
    currency: String(intent.currency || "BRL").toLowerCase(),
    customer: intent.provider_customer_id || null,
    subscription: null,
    payment_status: "paid",
    mode: "payment",
    mercadopago_payment: payment || null,
  };
}

/**
 * A "invoice" que o caminho de RENOVAÇÃO espera.
 *
 * `billing_reason` importa de verdade: é ele que o contador de apoiadores da
 * vaquinha usa para não contar a mesma pessoa de novo todo mês. A primeira
 * cobrança é reconhecida pela intenção ainda não paga.
 */
function buildInvoiceLike(intent, { paymentId, subscriptionId, amountReais, firstCharge }) {
  const cents = mp.reaisToCents(amountReais);
  return {
    id: paymentId || null,
    object: "invoice",
    provider: PROVIDER,
    subscription: subscriptionId || (intent && intent.provider_ref) || null,
    charge: paymentId || null,
    payment_intent: paymentId || null,
    amount_paid: cents,
    total: cents,
    billing_reason: firstCharge ? "subscription_create" : "subscription_cycle",
    metadata: (intent && intent.payload) || {},
    lines: { data: [] },
  };
}

/**
 * O "charge" que a cadeia de estorno espera.
 *
 * ⚠️ `amount` e `amount_refunded` são lidos por `isFullRefund`. O estorno que a
 * plataforma dispara é sempre TOTAL, mas um estorno PARCIAL feito à mão no
 * painel do Mercado Pago chega aqui pelo mesmo evento — e, sem o valor real
 * devolvido, ele cancelaria o pedido inteiro de quem recebeu só uma parte.
 *
 * ⚠️ `invoice` e `subscription` preenchidos são o que faz o estorno de
 * ASSINATURA funcionar. No Stripe, achar a assinatura a partir de um estorno é
 * uma viagem (charge → invoice → subscription, com ida à rede no meio). Sem
 * eles, os três consumidores (Atendimento IA, assinatura de perfil e a busca do
 * pedido) pediriam ao STRIPE uma fatura com id do Mercado Pago, cairiam no
 * catch e devolveriam "ignorado": dinheiro devolvido e serviço ligado.
 */
function buildChargeLike(payment, { subscriptionId = null } = {}) {
  const paymentId = payment && payment.id ? String(payment.id) : null;
  const gross = mp.reaisToCents(payment && payment.transaction_amount);

  // A soma do que já foi devolvido. `transaction_amount_refunded` é o campo do
  // Mercado Pago; ausente, assume-se total (o estorno da casa é sempre total).
  const refundedRaw =
    payment && payment.transaction_amount_refunded != null
      ? payment.transaction_amount_refunded
      : payment && payment.transaction_amount;

  return {
    id: paymentId,
    object: "charge",
    provider: PROVIDER,
    payment_intent: paymentId,
    amount: gross,
    amount_refunded: mp.reaisToCents(refundedRaw),
    invoice: paymentId,
    subscription: subscriptionId,
    mercadopago_payment: payment || null,
  };
}

/**
 * A "subscription" que `handleSubscriptionDeleted` espera.
 *
 * ⚠️ `id` é o da assinatura NO MERCADO PAGO, e não o da intenção — ao contrário
 * do `buildSessionLike`. A diferença não é capricho: os quatro fluxos
 * recorrentes gravaram `session.subscription` na coluna `stripe_subscription_id`
 * e é por ESSE valor que os handlers procuram a linha. Passar o id da intenção
 * aqui faria os quatro responderem "não encontrado" e o cancelamento não teria
 * efeito nenhum.
 */
function buildSubscriptionLike(preapproval) {
  return {
    id: (preapproval && preapproval.id) || null,
    object: "subscription",
    provider: PROVIDER,
    status: (preapproval && preapproval.status) || null,
    mercadopago_preapproval: preapproval || null,
  };
}

// ─────────────────────────── Os três tópicos ────────────────────────────────

async function handlePaymentTopic(event, dataId) {
  const payment = await mp.getPayment(dataId);
  const kind = kindOfPaymentStatus(payment && payment.status);

  if (kind === EVENT_KIND.IGNORED) {
    // `pending`, `in_process`, `authorized`, `rejected`: nada a fazer ainda.
    log.debug("payment.status_ignored", { payment_id: dataId, status: payment && payment.status });
    return { ignored: true, reason: `status_${payment && payment.status}` };
  }

  const intent = await findIntentForPayment(payment);
  if (!intent) {
    // ⚠️ Não é erro: o Mercado Pago avisa de TODA cobrança da conta, inclusive
    // as criadas à mão no painel ou por outro produto, que nunca passaram por
    // aqui. Estourar faria o endpoint devolver 500 e o Mercado Pago re-tentar
    // para sempre uma cobrança que não é nossa.
    log.info("intent.not_found", { payment_id: dataId, status: payment && payment.status });
    return { ignored: true, reason: "intent_not_found" };
  }

  await restampProviderRef(intent, payment);
  const firstCharge = intent.status === "created";

  if (kind === EVENT_KIND.CHECKOUT_PAID) {
    const session = buildSessionLike(intent, payment);
    await StripeWebhookService.fulfillCheckoutSession(session);
    await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "paid");
    return { ok: true, kind };
  }

  if (kind === EVENT_KIND.REFUNDED) {
    const charge = buildChargeLike(payment);
    await StripeWebhookService.dispatchEvent({
      id: event.id,
      type: "charge.refunded",
      data: { object: charge },
    });
    await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "refunded");
    return { ok: true, kind };
  }

  // CHECKOUT_EXPIRED (`cancelled`).
  //
  // ⚠️ Só expira o que ainda não foi pago. Um `cancelled` que chega depois de a
  // cobrança ter sido paga e entregue (reentrega fora de ordem, que é o normal
  // num webhook at-least-once) não pode cancelar um pedido já entregue.
  if (!firstCharge) return { ignored: true, reason: "already_settled" };
  const session = buildSessionLike(intent, payment);
  await StripeWebhookService.expireCheckoutSession(session, "payment.cancelled");
  await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "expired");
  return { ok: true, kind };
}

async function handlePreapprovalTopic(event, dataId) {
  const preapproval = await mp.getPreapproval(dataId);
  const status = String((preapproval && preapproval.status) || "").toLowerCase();

  // ⚠️ `authorized` NÃO entrega nada aqui. Ele significa "o cartão foi
  // aceito", não "o mês foi pago" — quem entrega é a cobrança, que chega pelo
  // tópico de pagamento. Entregar no `authorized` liberaria o produto antes de
  // existir dinheiro.
  //
  // `paused` também não: assinatura pausada pode voltar a cobrar sozinha, e
  // tirar o acesso de quem não pediu para sair seria pior que esperar.
  if (status !== "cancelled") {
    return { ignored: true, reason: `preapproval_${status || "unknown"}` };
  }

  const intent = await PaymentIntentStorage.getByProviderRef(pool, PROVIDER, String(dataId));
  if (!intent) {
    log.info("intent.not_found", { preapproval_id: dataId, status });
    return { ignored: true, reason: "intent_not_found" };
  }

  await StripeWebhookService.dispatchEvent({
    id: event.id,
    type: "customer.subscription.deleted",
    data: { object: buildSubscriptionLike(preapproval) },
  });
  await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "canceled");
  return { ok: true, kind: EVENT_KIND.SUBSCRIPTION_ENDED };
}

/**
 * A fatura mensal de uma assinatura.
 *
 * ⚠️ ÚNICO CAMINHO NÃO CONFERIDO CONTRA A API — pendência de QA em sandbox. A
 * leitura do recurso é embrulhada: não conseguindo ler, o evento volta como
 * `ignored` com o motivo, e NÃO como erro. A diferença importa: erro faria o
 * Mercado Pago re-entregar para sempre um aviso que não sabemos ler, e a
 * entrega dele é sequencial — travaria a fila dos eventos que importam.
 */
async function handleAuthorizedPaymentTopic(event, dataId) {
  let authorized = null;
  try {
    authorized = await mp.getAuthorizedPayment(dataId);
  } catch (err) {
    log.warn("authorized_payment.read_fail", { id: dataId, message: err && err.message });
    return { ignored: true, reason: "authorized_payment_unreadable" };
  }

  const status = String((authorized && authorized.status) || "").toLowerCase();
  const subscriptionId = (authorized && authorized.preapproval_id) || null;
  if (!subscriptionId) return { ignored: true, reason: "no_preapproval_id" };

  const intent = await PaymentIntentStorage.getByProviderRef(
    pool,
    PROVIDER,
    String(subscriptionId)
  );
  if (!intent) {
    log.info("intent.not_found", { preapproval_id: subscriptionId });
    return { ignored: true, reason: "intent_not_found" };
  }

  const firstCharge = intent.status === "created";
  const paymentId =
    (authorized && authorized.payment && authorized.payment.id) ||
    (authorized && authorized.id) ||
    null;
  const amountReais =
    (authorized && authorized.transaction_amount) ??
    mp.centsToReais(intent.amount_cents);

  // ⚠️ MENSALIDADE QUE FALHOU NÃO É "COBRANÇA EXPIRADA" — é INADIMPLÊNCIA, e os
  // dois casos terminam em lugares opostos: expirar cancela um pedido que nunca
  // foi entregue; inadimplir marca `past_due` numa assinatura que está de pé.
  const failed = status === "rejected" || status === "cancelled";
  const invoice = buildInvoiceLike(intent, {
    paymentId: paymentId ? String(paymentId) : null,
    subscriptionId: String(subscriptionId),
    amountReais,
    firstCharge,
  });

  if (failed) {
    await StripeWebhookService.dispatchEvent({
      id: event.id,
      type: "invoice.payment_failed",
      data: { object: invoice },
    });
    return { ok: true, kind: EVENT_KIND.SUBSCRIPTION_PAYMENT_FAILED };
  }

  if (status !== "approved" && status !== "processed") {
    return { ignored: true, reason: `authorized_payment_${status || "unknown"}` };
  }

  // A PRIMEIRA cobrança passa pelo confirmador de checkout (é ela que cria a
  // assinatura do lado de cá); as seguintes têm caminho próprio de renovação.
  if (firstCharge) {
    const session = {
      ...buildSessionLike(intent, { id: paymentId, transaction_amount: amountReais }),
      subscription: String(subscriptionId),
      mode: "subscription",
    };
    await StripeWebhookService.fulfillCheckoutSession(session);
    await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "paid");
    return { ok: true, kind: EVENT_KIND.CHECKOUT_PAID, recurring: true };
  }

  await StripeWebhookService.dispatchEvent({
    id: event.id,
    type: "invoice.paid",
    data: { object: invoice },
  });
  return { ok: true, kind: EVENT_KIND.SUBSCRIPTION_PAID, recurring: true };
}

async function dispatchEvent(event) {
  const type = String((event && (event.type || event.topic)) || "").toLowerCase();
  const dataId = event && event.data && event.data.id ? String(event.data.id) : null;

  if (!dataId) {
    log.debug("unhandled.event", { type, reason: "no_data_id" });
    return { ignored: true, reason: "no_data_id" };
  }

  if (type === "payment") return handlePaymentTopic(event, dataId);
  if (type === "subscription_preapproval" || type === "preapproval") {
    return handlePreapprovalTopic(event, dataId);
  }
  if (type === "subscription_authorized_payment" || type === "authorized_payment") {
    return handleAuthorizedPaymentTopic(event, dataId);
  }

  log.debug("unhandled.event", { type });
  return { ignored: true, reason: `topic_${type || "unknown"}` };
}

/**
 * Chave de dedupe.
 *
 * ⚠️ O Mercado Pago é at-least-once: sem 2xx em 22 segundos ele re-entrega a
 * cada 15 minutos. Sem dedupe, um Polén comprado seria creditado duas vezes.
 *
 * ⚠️ A chave é o `id` DA NOTIFICAÇÃO, não o do recurso. `payment.created` e
 * `payment.updated` do MESMO pagamento são dois avisos legítimos e distintos
 * (um deles é o que traz `approved`); deduplicar pelo id do pagamento engoliria
 * o segundo e a entrega nunca aconteceria.
 *
 * Sem `id` no corpo, a chave é composta pelo que identifica o aviso — melhor
 * que recusar o evento, que deixaria o pagamento sem entrega.
 */
function eventKey(event) {
  if (event && event.id) return `mp:${event.id}`;
  const type = (event && (event.type || event.topic)) || "unknown";
  const action = (event && event.action) || "unknown";
  const dataId = (event && event.data && event.data.id) || "unknown";
  return `mp:${type}:${action}:${dataId}`;
}

/**
 * At-least-once, exatamente como o do Stripe: o evento é reivindicado, e só
 * vira 'done' se o despacho terminar sem erro.
 */
async function processEvent(event) {
  const eventId = eventKey(event);

  const { duplicate } = await StripeWebhookEventStorage.claim(pool, {
    event_id: eventId,
    event_type: String((event && (event.action || event.type)) || "unknown"),
    payload: event,
    provider: PROVIDER,
  });

  if (duplicate) {
    log.info("duplicate.skip", { event_id: eventId });
    return { duplicate: true };
  }

  try {
    const result = await dispatchEvent(event);
    await StripeWebhookEventStorage.markDone(pool, eventId);
    return result;
  } catch (err) {
    await StripeWebhookEventStorage.markFailed(pool, eventId, err.message);
    throw err;
  }
}

module.exports = {
  PROVIDER,
  STATUS_KIND,
  kindOfPaymentStatus,
  findIntentForPayment,
  buildSessionLike,
  buildInvoiceLike,
  buildChargeLike,
  buildSubscriptionLike,
  eventKey,
  dispatchEvent,
  processEvent,
};
