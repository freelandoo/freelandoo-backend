// src/services/AsaasWebhookService.js
// O webhook do Asaas — e a REIDRATAÇÃO que fez os 18 fluxos migrarem sem
// reescrever os 18 confirmadores.
//
// ─── A IDEIA CENTRAL ────────────────────────────────────────────────────────
//
// Os confirmadores (`confirmStripeSession`) leem um punhado pequeno de campos
// de uma Checkout Session: `id`, `metadata`, `payment_intent`, `amount_total`,
// `customer`, `subscription`. Nenhum deles fala com o Stripe — todos falam com
// esse OBJETO.
//
// Então o webhook do Asaas não precisa de 18 confirmadores novos: precisa
// montar um objeto com essa forma a partir da nossa intenção (mig 231) e
// entregá-lo ao MESMO `fulfillCheckoutSession` que o Stripe usa.
//
// ⚠️ ISSO NÃO É UM TRUQUE DE COMPATIBILIDADE — é o que impede as duas verdades.
// Dezoito confirmadores paralelos, um por provedor, divergiriam na primeira
// regra de negócio nova (um desconto, um holdback, uma comissão), e a
// divergência apareceria como dinheiro entregue de um jeito no Stripe e de
// outro no Asaas, sem erro nenhum.
//
// ─── O QUE `metadata` VIRA AQUI ─────────────────────────────────────────────
//
// No Stripe o significado da cobrança viajava no `metadata` da sessão. No Asaas
// ele viaja no NOSSO banco: `tb_payment_intent.payload`. A reidratação devolve
// esse payload ao campo `metadata`, e o confirmador não percebe a diferença.

const pool = require("../databases");
const PaymentIntentStorage = require("../storages/PaymentIntentStorage");
const StripeWebhookEventStorage = require("../storages/StripeWebhookEventStorage");
const StripeWebhookService = require("./StripeWebhookService");
const asaas = require("../integrations/payments/asaasClient");
const { EVENT_KIND } = require("../integrations/payments/contract");
const { createLogger } = require("../utils/logger");

const log = createLogger("AsaasWebhookService");

/**
 * Evento do Asaas → o que fazer.
 *
 * ⚠️ `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` AMBOS entregam, e não é
 * redundância: CONFIRMED é "o cliente pagou" e RECEIVED é "o dinheiro caiu na
 * conta" — num boleto isso pode levar dias. Esperar o RECEIVED para liberar o
 * produto deixaria quem pagou sem o que comprou. Entregar nos dois é seguro
 * porque os confirmadores são idempotentes (o segundo vira `duplicate`).
 *
 * ⚠️ O que NÃO entra: `PAYMENT_CHARGEBACK_REQUESTED`. O Stripe hoje também não
 * trata disputa (só `charge.refunded`), e inventar aqui uma reversão que o
 * outro provedor não faz criaria exatamente a divergência que este arquivo
 * existe para evitar. Fica registrado como lacuna CONHECIDA dos dois.
 */
const EVENT_MAP = Object.freeze({
  PAYMENT_CONFIRMED: EVENT_KIND.CHECKOUT_PAID,
  PAYMENT_RECEIVED: EVENT_KIND.CHECKOUT_PAID,
  PAYMENT_REFUNDED: EVENT_KIND.REFUNDED,
  PAYMENT_DELETED: EVENT_KIND.CHECKOUT_EXPIRED,
  PAYMENT_OVERDUE: EVENT_KIND.CHECKOUT_EXPIRED,

  // ⚠️ OS DOIS EVENTOS QUE FALTAVAM, e sem eles a assinatura era um caminho só
  // de ida: a plataforma sabia COMEÇAR a cobrar pelo Asaas e nunca ficava
  // sabendo que a cobrança tinha ACABADO.
  //
  // Eles chegam numa FILA PRÓPRIA do Asaas — o painel lista "eventos para
  // assinaturas" separado de "eventos para cobranças", e o mesmo endpoint
  // recebe os dois desde que os dois estejam marcados. ⚠️ Marcar só o grupo de
  // cobranças (que é o caminho óbvio) deixa este bloco inteiro morto, sem erro
  // nenhum aparecer.
  //
  // INACTIVATED e DELETED terminam no mesmo lugar de propósito: para quem
  // assinou, "a assinatura foi desativada" e "a assinatura foi removida" são a
  // mesma notícia — parou de ser cobrado, então para de ter acesso.
  SUBSCRIPTION_DELETED: EVENT_KIND.SUBSCRIPTION_ENDED,
  SUBSCRIPTION_INACTIVATED: EVENT_KIND.SUBSCRIPTION_ENDED,
});

function kindOf(eventType) {
  return EVENT_MAP[eventType] || EVENT_KIND.IGNORED;
}

/**
 * Acha a intenção a partir da cobrança, em cascata.
 *
 * ⚠️ Os três caminhos existem porque o `externalReference` nem sempre chega:
 * as cobranças GERADAS por uma assinatura (o 2º mês em diante) podem vir sem o
 * campo que só a assinatura carrega. Sem o segundo salto — pelo id da
 * assinatura — toda renovação viraria um evento órfão, e a mensalidade pararia
 * de ser creditada em silêncio a partir do segundo mês.
 */
async function findIntent(payment) {
  const externalRef = payment && payment.externalReference;
  if (externalRef) {
    const byRef = await PaymentIntentStorage.getById(pool, externalRef).catch(() => null);
    if (byRef) return byRef;
  }
  if (payment && payment.subscription) {
    const bySub = await PaymentIntentStorage.getByProviderRef(pool, "asaas", payment.subscription);
    if (bySub) return bySub;
  }
  if (payment && payment.id) {
    const byPayment = await PaymentIntentStorage.getByProviderRef(pool, "asaas", payment.id);
    if (byPayment) return byPayment;
  }
  return null;
}

/**
 * A intenção a partir de um evento de ASSINATURA.
 *
 * ⚠️ O payload de assinatura não tem `payment` — tem `subscription`, com uma
 * forma própria (`{ id, status, externalReference, deleted }`). Reusar
 * `findIntent` aqui devolveria `null` sempre, e o evento viraria um no-op
 * silencioso: a assinatura acabaria no Asaas e seguiria ativa aqui dentro.
 *
 * O `externalReference` é o id da nossa intenção (nós o mandamos ao criar), mas
 * ele pode voltar vazio; o segundo salto é pelo `provider_ref`, que é onde o id
 * da assinatura do Asaas foi carimbado na criação.
 */
async function findIntentForSubscription(subscription) {
  const externalRef = subscription && subscription.externalReference;
  if (externalRef) {
    const byRef = await PaymentIntentStorage.getById(pool, externalRef).catch(() => null);
    if (byRef) return byRef;
  }
  if (subscription && subscription.id) {
    return PaymentIntentStorage.getByProviderRef(pool, "asaas", subscription.id);
  }
  return null;
}

/**
 * A "subscription" que `handleSubscriptionDeleted` espera.
 *
 * ⚠️ `id` é o da assinatura NO ASAAS, e não o da intenção — ao contrário do
 * `buildSessionLike`. A diferença não é capricho: os quatro fluxos recorrentes
 * gravaram `session.subscription` na coluna `stripe_subscription_id`, e é por
 * ESSE valor que os handlers procuram a linha. Passar o id da intenção aqui
 * faria os quatro responderem "não encontrado" e o cancelamento não teria
 * efeito nenhum.
 */
function buildSubscriptionLike(subscription) {
  return {
    id: (subscription && subscription.id) || null,
    object: "subscription",
    provider: "asaas",
    status: (subscription && subscription.status) || null,
    asaas_subscription: subscription || null,
  };
}

/**
 * A "Checkout Session" que os confirmadores esperam.
 *
 * ⚠️ `id` é o da INTENÇÃO, não o do Asaas — é esse valor que foi gravado como
 * `stripe_session_id` na criação, e é por ele que cada confirmador acha o
 * pedido. Usar o id do Asaas aqui faria todos os 18 responderem "não
 * encontrado" e o pagamento ficaria cobrado e sem entrega.
 */
function buildSessionLike(intent, payment) {
  return {
    id: intent.id_payment_intent,
    object: "checkout.session",
    provider: "asaas",
    metadata: intent.payload || {},
    client_reference_id: intent.id_user || null,
    // No Asaas o papel do PaymentIntent do Stripe é da própria cobrança: é o id
    // que o estorno recebe, e é ele que os pedidos gravam.
    payment_intent: (payment && payment.id) || intent.provider_ref || null,
    amount_total: Number(intent.amount_cents) || asaas.reaisToCents(payment && payment.value),
    currency: String(intent.currency || "BRL").toLowerCase(),
    customer: intent.provider_customer_id || (payment && payment.customer) || null,
    subscription: (payment && payment.subscription) || null,
    payment_status: "paid",
    mode: payment && payment.subscription ? "subscription" : "payment",
    asaas_payment: payment || null,
  };
}

/**
 * A "invoice" que o caminho de RENOVAÇÃO espera.
 *
 * `billing_reason` importa de verdade: é ele que o contador de apoiadores da
 * vaquinha usa para não contar a mesma pessoa de novo todo mês. A primeira
 * cobrança é reconhecida pela intenção ainda não paga.
 */
function buildInvoiceLike(intent, payment, { firstCharge }) {
  const cents = asaas.reaisToCents(payment && payment.value);
  return {
    id: (payment && payment.id) || null,
    object: "invoice",
    provider: "asaas",
    subscription: (payment && payment.subscription) || (intent && intent.provider_ref) || null,
    charge: (payment && payment.id) || null,
    payment_intent: (payment && payment.id) || null,
    amount_paid: cents,
    total: cents,
    billing_reason: firstCharge ? "subscription_create" : "subscription_cycle",
    metadata: (intent && intent.payload) || {},
    lines: { data: [] },
    asaas_payment: payment || null,
  };
}

/**
 * O "charge" que a cadeia de estorno espera.
 *
 * ⚠️ `amount` e `amount_refunded` são lidos por `isFullRefund`. O estorno que a
 * plataforma dispara é sempre TOTAL, mas um estorno PARCIAL feito à mão no
 * painel do Asaas chega aqui pelo mesmo evento — e, sem o `refundedValue` real,
 * ele cancelaria o pedido inteiro de quem recebeu só uma parte de volta.
 */
function buildChargeLike(payment) {
  const cents = asaas.reaisToCents(payment && payment.value);
  const refundedRaw =
    payment && payment.refundedValue != null ? payment.refundedValue : payment && payment.value;
  return {
    id: (payment && payment.id) || null,
    object: "charge",
    provider: "asaas",
    payment_intent: (payment && payment.id) || null,
    amount: cents,
    amount_refunded: asaas.reaisToCents(refundedRaw),
    // ⚠️ ESTES DOIS CAMPOS SÃO O QUE FAZ O ESTORNO DE ASSINATURA FUNCIONAR.
    //
    // No Stripe, achar a assinatura a partir de um estorno é uma viagem:
    // charge → invoice → subscription, com uma ida à rede no meio. No Asaas não
    // existe `invoice` — a cobrança É a fatura —, e a assinatura vem junto do
    // próprio evento.
    //
    // Sem eles, os três consumidores (Atendimento IA, assinatura de perfil e a
    // busca do pedido) pediriam ao STRIPE uma fatura com id do Asaas, cairiam
    // no catch e devolveriam "ignorado": dinheiro devolvido e serviço ligado.
    invoice: (payment && payment.id) || null,
    subscription: (payment && payment.subscription) || null,
    asaas_payment: payment || null,
  };
}

async function dispatchEvent(event) {
  const kind = kindOf(event && event.event);

  if (kind === EVENT_KIND.IGNORED) {
    log.debug("unhandled.event", { type: (event && event.event) || null });
    return { ignored: true };
  }

  // ─── ASSINATURA ENCERRADA ─────────────────────────────────────────────────
  //
  // Vem ANTES do caminho de cobrança porque o payload é outro: aqui existe
  // `event.subscription` e NÃO existe `event.payment`. Deixado para depois, o
  // guard `!payment` engoliria o evento.
  if (kind === EVENT_KIND.SUBSCRIPTION_ENDED) {
    const subscription = (event && event.subscription) || null;
    if (!subscription || !subscription.id) return { ignored: true, reason: "no_subscription" };

    const intent = await findIntentForSubscription(subscription);
    if (!intent) {
      log.info("intent.not_found", { subscription_id: subscription.id, event: event.event });
      return { ignored: true, reason: "intent_not_found" };
    }

    await StripeWebhookService.dispatchEvent({
      id: event.id,
      type: "customer.subscription.deleted",
      data: { object: buildSubscriptionLike(subscription) },
    });
    await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "canceled");
    return { ok: true, kind };
  }

  // ─── COBRANÇA ─────────────────────────────────────────────────────────────
  const payment = (event && event.payment) || null;
  if (!payment) {
    log.debug("unhandled.event", { type: (event && event.event) || null });
    return { ignored: true };
  }

  const intent = await findIntent(payment);
  if (!intent) {
    // ⚠️ Não é erro: o Asaas manda evento de TODA cobrança da conta, inclusive
    // as criadas à mão no painel, que nunca passaram por aqui. Estourar faria o
    // endpoint devolver 500 e o Asaas re-tentar para sempre uma cobrança que
    // não é nossa.
    log.info("intent.not_found", { payment_id: payment.id || null, event: event.event });
    return { ignored: true, reason: "intent_not_found" };
  }

  const isRecurring = !!payment.subscription;
  const firstCharge = intent.status === "created";

  if (kind === EVENT_KIND.CHECKOUT_PAID) {
    // A renovação de assinatura não passa pelo confirmador de checkout: ela tem
    // caminho próprio (crédito de mensalidade, ciclo, comissão recorrente).
    if (isRecurring && !firstCharge) {
      const invoice = buildInvoiceLike(intent, payment, { firstCharge: false });
      await StripeWebhookService.dispatchEvent({
        id: event.id,
        type: "invoice.paid",
        data: { object: invoice },
      });
      return { ok: true, kind, recurring: true };
    }

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

  if (kind === EVENT_KIND.CHECKOUT_EXPIRED) {
    // ⚠️ MENSALIDADE QUE VENCEU SEM SER PAGA NÃO É "COBRANÇA EXPIRADA" — é
    // INADIMPLÊNCIA, e os dois casos terminam em lugares opostos: expirar
    // cancela um pedido que nunca foi entregue; inadimplir marca `past_due`
    // numa assinatura que está de pé e entregando.
    //
    // Antes isto caía em `already_settled` e a renovação vencida era
    // silenciosamente descartada: quem parasse de pagar seguia com o acesso,
    // para sempre, sem uma linha de log dizendo por quê.
    //
    // ⚠️ Só o OVERDUE entra aqui. `PAYMENT_DELETED` numa renovação é uma
    // cobrança REMOVIDA (quase sempre à mão, no painel) — tratá-la como falha
    // de pagamento marcaria como caloteiro quem teve a cobrança cancelada pelo
    // próprio lojista.
    if (isRecurring && !firstCharge) {
      if (event.event !== "PAYMENT_OVERDUE") {
        return { ignored: true, reason: "already_settled" };
      }
      const invoice = buildInvoiceLike(intent, payment, { firstCharge: false });
      await StripeWebhookService.dispatchEvent({
        id: event.id,
        type: "invoice.payment_failed",
        data: { object: invoice },
      });
      return { ok: true, kind: EVENT_KIND.SUBSCRIPTION_PAYMENT_FAILED, recurring: true };
    }

    // ⚠️ Só expira o que ainda não foi pago. Um boleto que vence DEPOIS de pago
    // (o Asaas manda OVERDUE em cobranças antigas) não pode cancelar um pedido
    // já entregue.
    if (!firstCharge) return { ignored: true, reason: "already_settled" };
    const session = buildSessionLike(intent, payment);
    await StripeWebhookService.expireCheckoutSession(session, event.event);
    await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "expired");
    return { ok: true, kind };
  }

  return { ignored: true };
}

/**
 * At-least-once, exatamente como o do Stripe: o evento é reivindicado, e só
 * vira 'done' se o despacho terminar sem erro.
 *
 * ⚠️ O Asaas entrega o MESMO evento mais de uma vez e a doc manda persistir o
 * `id` por isso. Sem o dedupe, um Polén comprado seria creditado duas vezes.
 */
async function processEvent(event) {
  const eventId = event && event.id;
  if (!eventId) return { error: "evento sem id" };

  const { duplicate } = await StripeWebhookEventStorage.claim(pool, {
    event_id: eventId,
    event_type: event.event || "unknown",
    payload: event,
    provider: "asaas",
  });

  if (duplicate) {
    log.info("duplicate.skip", { event_id: eventId, type: event.event });
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
  EVENT_MAP,
  kindOf,
  findIntent,
  buildSessionLike,
  buildInvoiceLike,
  buildChargeLike,
  buildSubscriptionLike,
  findIntentForSubscription,
  dispatchEvent,
  processEvent,
};
