// src/integrations/payments/providers/mercadopago.js
// O Mercado Pago falando a língua do contrato.
//
// ─── A DECISÃO CENTRAL: QUEM É O "id" DA COBRANÇA ───────────────────────────
//
// O mesmo desenho que a migração do Asaas provou: o id que circula pela
// plataforma é o da NOSSA INTENÇÃO (o UUID da mig 231), não o do gateway.
//
// Resolve três problemas de uma vez:
//
// 1. O `successUrl` de vários fluxos carrega `{CHECKOUT_SESSION_ID}`, um
//    placeholder que só o Stripe substitui. O id da intenção existe ANTES da
//    chamada de rede, então dá para substituí-lo na hora de montar o link.
// 2. Os ~20 confirmadores buscam o pedido por `stripe_session_id`. Gravando o
//    id da intenção ali, eles continuam funcionando SEM UMA LINHA DE MUDANÇA.
// 3. Não amarra a plataforma ao formato de id de gateway nenhum.
//
// ─── ⚠️ E AQUI ELE FICA MAIS IMPORTANTE QUE NO ASAAS ────────────────────────
//
// No Asaas, `POST /payments` devolvia a cobrança pronta: havia um id de
// cobrança desde a criação. No Mercado Pago o que se cria é uma PREFERÊNCIA —
// a página de pagamento. O `payment` nasce só quando alguém paga, com um id
// diferente, que ninguém conhece na hora do clique.
//
// Então: `provider_ref` nasce com o id da PREFERÊNCIA e é RE-CARIMBADO com o id
// do PAYMENT quando o webhook chega (é o id do payment que o estorno recebe).
// Quem acha a intenção nunca depende disso: o fio é o `external_reference`, que
// carrega o id da intenção do começo ao fim.

const mp = require("../mercadoPagoClient");
const { STRIPE_ONLY_FIELDS } = require("../contract");

const PROVIDER = "mercadopago";

/**
 * O Mercado Pago tem cupom PRÓPRIO (`coupon_code`), que não é o cupom da
 * Freelandoo. Aceitar o campo e mandar para lá aplicaria um desconto que não
 * existe no nosso catálogo — ou nenhum, calado. O desconto da casa já vem
 * calculado no backend e embutido em `amount_cents` (auditoria A1).
 */
const UNSUPPORTED_FIELDS = STRIPE_ONLY_FIELDS;

/**
 * ⚠️ NÃO EXISTE `cancel_at_period_end` AQUI. Cancelar é `PUT status=cancelled`,
 * imediato.
 *
 * `SubscriptionEndService` lê isto e, por ser `false`, agenda a data do fim do
 * ciclo na fila da mig 251 em vez de cancelar na hora — senão quem cancela no
 * dia 3 perde o acesso no dia 3, com o mês inteiro já pago.
 */
const SUPPORTS_PERIOD_END = false;

/**
 * O Stripe substitui `{CHECKOUT_SESSION_ID}` sozinho; o Mercado Pago não
 * substitui nada. Sem isto a pessoa voltaria para
 * `?session_id={CHECKOUT_SESSION_ID}` literal e o fluxo não acharia o pedido.
 */
function resolveReturnUrl(url, intentId) {
  if (!url) return undefined;
  return String(url).replace(/\{CHECKOUT_SESSION_ID\}/g, encodeURIComponent(intentId));
}

/**
 * `auto_return` manda o Mercado Pago devolver a pessoa ao site sozinho depois
 * de aprovar.
 *
 * ⚠️ ELE EXIGE UMA URL PÚBLICA. Com `localhost` (ou http), a criação da
 * preferência é RECUSADA — não é o retorno que falha, é a compra inteira que
 * não nasce. Em desenvolvimento a pessoa volta pelo botão do próprio Mercado
 * Pago, que é degradação aceitável; recusar o checkout não é.
 */
function canAutoReturn(successUrl) {
  if (!successUrl) return false;
  try {
    const u = new URL(String(successUrl));
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".local")) return false;
    return h.includes(".");
  } catch {
    return false;
  }
}

/**
 * Para onde o Mercado Pago avisa que houve pagamento.
 *
 * ⚠️ Vai NA PREFERÊNCIA, e não só no painel. Configurado apenas no painel, um
 * ambiente novo (ou uma aplicação recriada) nasce sem notificação e as compras
 * ficam pagas e sem entrega, sem erro nenhum. Mandando nos dois, o painel passa
 * a ser reforço.
 *
 * Mesma regra do `auto_return`: URL não pública é OMITIDA em vez de recusada.
 */
function notificationUrl() {
  const explicit = String(process.env.MERCADOPAGO_NOTIFICATION_URL || "").trim();
  if (explicit) return canAutoReturn(explicit) ? explicit : undefined;

  const base = String(
    process.env.BASE_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  )
    .trim()
    .replace(/\/+$/, "");
  if (!base) return undefined;
  const url = `${base}/webhooks/mercadopago`;
  return canAutoReturn(url) ? url : undefined;
}

/**
 * Os itens da página de pagamento.
 *
 * ⚠️ AQUI O MERCADO PAGO GANHA DO ASAAS, e isso importa para o comprador: ele
 * aceita VÁRIOS itens e os mostra em linhas separadas, como o Stripe. O Asaas
 * cobra um valor só, e o frete tinha que ser costurado numa string de descrição
 * — a cobrança parecia um preço de produto inflado.
 *
 * ⚠️ `unit_price` é o valor UNITÁRIO em reais. Mandar o total de uma linha com
 * `quantity: 2` cobraria o dobro.
 */
function buildItems(req) {
  const items = Array.isArray(req.lineItems) ? req.lineItems : [];
  const currency = String(req.currency || "BRL").toUpperCase();

  if (items.length > 0) {
    return items.map((li) => {
      const quantity = Math.max(1, Math.round(Number(li.quantity) || 1));
      return {
        title: String(li.name || "Item").slice(0, 250),
        quantity,
        unit_price: mp.centsToReais(Math.round(Number(li.amount_cents) || 0)),
        currency_id: currency,
      };
    });
  }

  return [
    {
      title: String(req.productName || "Freelandoo").slice(0, 250),
      description: req.description ? String(req.description).slice(0, 250) : undefined,
      quantity: 1,
      unit_price: mp.centsToReais(req.amount_cents),
      currency_id: currency,
    },
  ];
}

/**
 * Cria a cobrança (ou a assinatura) e devolve algo com a forma de uma session.
 *
 * `intentId` vem de fora porque a intenção nasce ANTES da chamada de rede — é
 * a ordem que a mig 231 desenhou, e invertê-la deixaria cobrança de pé no
 * gateway sem linha nenhuma aqui.
 */
async function createCheckout(req, { intentId, customerId } = {}) {
  const successUrl = resolveReturnUrl(req.successUrl, intentId);
  const cancelUrl = resolveReturnUrl(req.cancelUrl, intentId);
  const currency = String(req.currency || "BRL").toUpperCase();

  if (req.recurring) {
    // ⚠️ `payer_email` É OBRIGATÓRIO no preapproval, e a recusa é EM VOZ ALTA.
    //
    // Sem e-mail o Mercado Pago recusaria a criação com uma mensagem de campo
    // ausente — o que já seria ruim —, mas o motivo de falhar aqui é outro:
    // quem chama precisa saber que fluxo recorrente sem e-mail do pagador não
    // tem como existir, em vez de descobrir isso como "erro do gateway".
    const payerEmail = String(req.customerEmail || "").trim();
    if (!payerEmail) {
      throw new Error(
        "Mercado Pago exige o e-mail de quem assina para criar uma assinatura — " +
          "passe `customerEmail` no checkout deste fluxo"
      );
    }

    const preapproval = await mp.createPreapproval(
      {
        reason: String(req.productName || "Assinatura Freelandoo").slice(0, 250),
        external_reference: intentId,
        payer_email: payerEmail,
        back_url: successUrl,
        status: "pending",
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: mp.centsToReais(req.amount_cents),
          currency_id: currency,
        },
        ...(notificationUrl() ? { notification_url: notificationUrl() } : {}),
      },
      { idempotencyKey: intentId }
    );

    return {
      id: intentId,
      url: preapproval.init_point || null,
      provider_ref: preapproval.id,
      // Os quatro fluxos recorrentes gravam `session.subscription` na coluna
      // `stripe_subscription_id`, e é por ESSE valor que eles procuram a linha
      // depois. Tem que ser o id do gateway, não o da intenção.
      subscription: preapproval.id,
      customer: customerId || null,
      raw: preapproval,
    };
  }

  const preference = await mp.createPreference(
    {
      items: buildItems(req),
      external_reference: intentId,
      back_urls: {
        success: successUrl,
        failure: cancelUrl,
        pending: successUrl,
      },
      ...(canAutoReturn(successUrl) ? { auto_return: "approved" } : {}),
      ...(req.customerEmail ? { payer: { email: String(req.customerEmail).trim() } } : {}),
      ...(notificationUrl() ? { notification_url: notificationUrl() } : {}),
    },
    { idempotencyKey: intentId }
  );

  return {
    id: intentId,
    url: preference.init_point || null,
    // ⚠️ A PREFERÊNCIA, não o payment — ele ainda não existe. O webhook
    // re-carimba com o id do payment, que é o que o estorno recebe.
    provider_ref: preference.id,
    // ⚠️ NULL DE PROPÓSITO, e é seguro: conferido que TODOS os leitores de
    // `session.payment_intent` estão no caminho de CONFIRMAÇÃO (webhook), onde
    // `buildSessionLike` já o preenche com o id do payment. Nenhum fluxo lê
    // este campo na criação.
    payment_intent: null,
    customer: customerId || null,
    raw: preference,
  };
}

function refund({ provider_ref, payment_intent_id }) {
  // No Mercado Pago o estorno é sobre o PAYMENT. `payment_intent_id` é o nome
  // que o contrato herdou do Stripe e carrega exatamente esse id.
  const id = payment_intent_id || provider_ref;
  return mp.refundPayment(id);
}

/**
 * ⚠️ Cancelar é IMEDIATO — não existe `cancel_at_period_end`. O `immediate` do
 * contrato é ACEITO e IGNORADO aqui de propósito: quem precisa de "vale até o
 * fim do ciclo" agenda a data (mig 251) e só chega aqui quando ela vence.
 * Fingir que o flag funciona faria o assinante perder na hora um mês pago.
 */
async function cancelSubscription(subscriptionId) {
  try {
    return await mp.cancelPreapproval(subscriptionId);
  } catch (err) {
    // ⚠️ 404 = JÁ NÃO EXISTE LÁ, E ISSO É SUCESSO, NÃO FALHA. Cancelar é
    // idempotente por natureza: se o Mercado Pago diz que a assinatura não
    // existe, então NÃO HÁ CARTÃO SENDO DEBITADO — o objetivo de quem chamou
    // está cumprido.
    //
    // Sem isto, a porta de SAÍDA fica trancada, e foi reproduzido contra a API
    // real: uma linha antiga apontando para um id que o gateway não conhece
    // (as assinaturas de teste do Stripe que sobraram no banco) faz
    // `SubscriptionEndService` cair no ramo "não sei o ciclo, cancela agora" e
    // estourar ali — 500 na cara de quem acabou de pedir para sair. Porta de
    // saída trancada é a única que não pode existir (regra do WhatsApp 224 e
    // da conta de jogo 220).
    //
    // ⚠️ SÓ O 404 É ENGOLIDO. Qualquer outro erro (401, 5xx, rede) significa
    // "NÃO SEI" — e responder "cancelado" sem saber deixaria um cartão sendo
    // debitado todo mês, que é o estrago que nunca aparece porque ninguém
    // reclama de acesso que continuou funcionando.
    //
    // (O 404 já sai no log pelo `call.fail` do cliente — este adapter não tem
    // logger próprio, e acrescentar um só para repetir a mesma linha seria uma
    // segunda voz dizendo a mesma coisa.)
    if (err && err.statusCode === 404) {
      return { id: subscriptionId, status: "cancelled", already_gone: true };
    }
    throw err;
  }
}

/** Quantos MESES dura um ciclo, por `frequency_type` do Mercado Pago. */
const FREQUENCY_MONTHS = Object.freeze({
  months: 1,
  days: 1 / 30,
});

/**
 * A janela do ciclo vigente.
 *
 * ⚠️ COMO NO ASAAS, ELA É DERIVADA e não lida: o Mercado Pago tem
 * `next_payment_date` + `auto_recurring.{frequency,frequency_type}`, e não os
 * `current_period_start/end` prontos do Stripe. O fim do ciclo que acabou de
 * ser pago é o vencimento do PRÓXIMO, e o começo é um ciclo antes dele.
 *
 * Pedir os campos do Stripe aqui devolve `undefined` nos dois, e o efeito é
 * mudo: o contador de tokens do bot do Atendimento IA nunca ganha âncora e a
 * cota do assinante nunca zera.
 */
async function getSubscriptionPeriod(subscriptionId) {
  const sub = await mp.getPreapproval(subscriptionId);
  const raw = sub && sub.next_payment_date;
  const next = raw ? new Date(raw) : null;
  if (!next || Number.isNaN(next.getTime())) return { period_start: null, period_end: null };

  const rec = (sub && sub.auto_recurring) || {};
  const unit = FREQUENCY_MONTHS[String(rec.frequency_type || "months").toLowerCase()] ?? 1;
  const freq = Math.max(1, Number(rec.frequency) || 1);
  const months = unit * freq;

  const start = new Date(next.getTime());
  if (months >= 1) {
    start.setMonth(start.getMonth() - Math.round(months));
  } else {
    start.setDate(start.getDate() - Math.round(months * 30));
  }
  return { period_start: start, period_end: next };
}

/**
 * A taxa REAL que o provedor cobrou desta cobrança.
 *
 * ⚠️ ISTO SAI DO BOLSO DO VENDEDOR: `processor_fee_cents` é descontado do
 * repasse. Enquanto ela não é apurada, a Loja usa a ESTIMATIVA — e a estimativa
 * está calibrada para a tarifa do Stripe, então a diferença vira retenção
 * indevida (ou prejuízo nosso) em toda venda.
 *
 * ⚠️ AQUI O MERCADO PAGO É MELHOR QUE O ASAAS, e a diferença é de confiança: o
 * Asaas não tem campo de tarifa — ela era DEDUZIDA de `value − netValue`, com
 * um guard porque `netValue` ausente produziria "taxa = valor inteiro" e
 * zeraria o repasse. Aqui a tarifa é um campo: `fee_details[]`.
 *
 * ⚠️ E SÓ ENTRA O QUE O RECEBEDOR PAGA (`fee_payer === "collector"`). Juros de
 * parcelamento bancados pelo COMPRADOR também aparecem em `fee_details` com
 * `fee_payer: "payer"` — somá-los descontaria do vendedor uma tarifa que ele
 * nunca pagou.
 */
async function getChargeFee(provider_ref) {
  const payment = await mp.getPayment(provider_ref);
  const charge_id = (payment && String(payment.id)) || null;

  const details = Array.isArray(payment && payment.fee_details) ? payment.fee_details : [];
  const collectorFees = details.filter(
    (d) => d && String(d.fee_payer || "").toLowerCase() === "collector"
  );

  if (collectorFees.length > 0) {
    const reais = collectorFees.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const cents = mp.reaisToCents(reais);
    if (Number.isFinite(cents) && cents >= 0) {
      return { fee_cents: cents, charge_id, source: "mercadopago_fee" };
    }
  }

  // Reserva: o líquido recebido. Só vale quando os DOIS números existem —
  // ⚠️ `Number(null)` é ZERO, e sem este guard uma cobrança sem
  // `net_received_amount` produziria "taxa = valor inteiro".
  const gross = Number(payment && payment.transaction_amount);
  const net = Number(payment && payment.transaction_details && payment.transaction_details.net_received_amount);
  if (Number.isFinite(gross) && Number.isFinite(net) && net > 0) {
    const fee = mp.reaisToCents(gross) - mp.reaisToCents(net);
    if (Number.isFinite(fee) && fee >= 0) {
      return { fee_cents: fee, charge_id, source: "mercadopago_fee" };
    }
  }

  // ⚠️ `null` NÃO É ZERO: quem chama tem que MANTER a estimativa. Assumir zero
  // pagaria ao vendedor dinheiro que o gateway já retirou.
  return { fee_cents: null, charge_id, source: null };
}

module.exports = {
  PROVIDER,
  UNSUPPORTED_FIELDS,
  SUPPORTS_PERIOD_END,
  FREQUENCY_MONTHS,
  resolveReturnUrl,
  canAutoReturn,
  notificationUrl,
  buildItems,
  createCheckout,
  refund,
  cancelSubscription,
  getSubscriptionPeriod,
  getChargeFee,
};
