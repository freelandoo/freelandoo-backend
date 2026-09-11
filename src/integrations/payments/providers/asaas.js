// src/integrations/payments/providers/asaas.js
// O Asaas falando a língua do contrato.
//
// ─── A DECISÃO CENTRAL: QUEM É O "id" DA COBRANÇA ───────────────────────────
//
// Para o Stripe, o id que circula pela plataforma é o `cs_...` da Checkout
// Session. Para o Asaas, o id que circula é o da NOSSA INTENÇÃO (o UUID da
// mig 231) — não o `pay_...` dele.
//
// Parece arbitrário e resolve três problemas de uma vez:
//
// 1. O `successUrl` de vários fluxos carrega `{CHECKOUT_SESSION_ID}`, um
//    placeholder que só o Stripe substitui. O Asaas mandaria a pessoa de volta
//    com a chave literal na URL. O id da intenção existe ANTES da chamada de
//    rede, então dá para substituí-lo na hora de montar o link.
// 2. Os 18 confirmadores buscam o pedido por `stripe_session_id`. Gravando o id
//    da intenção ali, eles continuam funcionando SEM UMA LINHA DE MUDANÇA — o
//    webhook só precisa reidratar `session.id` com o mesmo valor.
// 3. Não amarra a plataforma ao formato de id de um gateway.
//
// O id do Asaas não se perde: ele vai para `provider_ref`, que é por onde o
// webhook acha a intenção e por onde o estorno encontra a cobrança.
//
// ⚠️ `externalReference` É O ÚNICO FIO entre a cobrança e o que ela significa.
// O Asaas não tem metadata — é uma string só. Ela carrega o id da intenção, e
// é a mig 231 que guarda o resto.

const asaas = require("../asaasClient");
const { STRIPE_ONLY_FIELDS } = require("../contract");

const PROVIDER = "asaas";

/** O Asaas não tem cupom. Mandar um seria cobrar o valor cheio calado. */
const UNSUPPORTED_FIELDS = STRIPE_ONLY_FIELDS;

/** Dias até o vencimento de uma cobrança avulsa. Pix cai na hora; boleto, não. */
const DUE_DAYS = Number(process.env.ASAAS_DUE_DAYS || 3);

/**
 * `UNDEFINED` deixa a fatura oferecer Pix, boleto e cartão, e quem paga decide
 * — é o mais perto do checkout do Stripe de hoje.
 */
const BILLING_TYPE = String(process.env.ASAAS_BILLING_TYPE || "UNDEFINED").toUpperCase();

/**
 * O Stripe substitui `{CHECKOUT_SESSION_ID}` sozinho; o Asaas não substitui
 * nada. Sem isto a pessoa voltaria para `?session_id={CHECKOUT_SESSION_ID}`.
 */
function resolveReturnUrl(url, intentId) {
  if (!url) return undefined;
  return String(url).replace(/\{CHECKOUT_SESSION_ID\}/g, encodeURIComponent(intentId));
}

/**
 * O Asaas cobra UM valor, sem linhas separadas. Quando o fluxo manda vários
 * itens (produto + frete), eles viram uma descrição legível — o total já vem
 * somado em `amount_cents` por quem chamou.
 *
 * ⚠️ A descrição é o ÚNICO lugar onde o comprador vê o frete discriminado na
 * fatura do Asaas. Omiti-la faria a cobrança parecer um preço de produto
 * inflado.
 */
function buildDescription(req) {
  // Descrição explícita vence: é o texto que o fluxo escreveu para quem paga
  // (o sinal de agendamento explica data, hora e taxa). O nome do produto é o
  // fallback de quem não tem nada melhor a dizer.
  if (req.description) return String(req.description).slice(0, 500);

  const items = Array.isArray(req.lineItems) ? req.lineItems : [];
  if (items.length > 1) {
    const parts = items.map((li) => {
      const qty = Math.max(1, Number(li.quantity) || 1);
      const label = String(li.name || "Item").trim();
      return qty > 1 ? `${qty}x ${label}` : label;
    });
    return parts.join(" + ").slice(0, 500);
  }
  return String(req.productName || "Freelandoo").slice(0, 500);
}

/**
 * Cria a cobrança (ou a assinatura) e devolve algo com a forma de uma session.
 *
 * `intentId` vem de fora porque a intenção nasce ANTES da chamada de rede — é
 * a ordem que a mig 231 desenhou, e invertê-la deixaria cobrança de pé no
 * gateway sem linha nenhuma aqui.
 */
async function createCheckout(req, { intentId, customerId }) {
  const base = {
    customer: customerId,
    billingType: BILLING_TYPE,
    value: asaas.centsToReais(req.amount_cents),
    externalReference: intentId,
    description: buildDescription(req),
    callback: {
      successUrl: resolveReturnUrl(req.successUrl, intentId),
      autoRedirect: true,
    },
  };

  if (req.recurring) {
    // ⚠️ AVISO DE PRODUTO, não detalhe técnico: no Asaas só o CARTÃO cobra
    // sozinho. Em Pix ou boleto a assinatura apenas GERA a cobrança todo mês e
    // o cliente precisa pagar cada uma — não é débito automático como no
    // Stripe. Os 4 fluxos recorrentes mudam de comportamento ao migrar.
    const subscription = await asaas.createSubscription({
      ...base,
      cycle: "MONTHLY",
      nextDueDate: asaas.dueDateFromNow(0),
    });
    return {
      id: intentId,
      url: subscription.invoiceUrl || subscription.paymentLink || null,
      provider_ref: subscription.id,
      subscription: subscription.id,
      customer: customerId,
      raw: subscription,
    };
  }

  const payment = await asaas.createPayment({
    ...base,
    dueDate: asaas.dueDateFromNow(DUE_DAYS),
  });

  return {
    id: intentId,
    url: payment.invoiceUrl,
    provider_ref: payment.id,
    // `payment_intent` do Stripe = "a cobrança em si". No Asaas esse papel é do
    // próprio payment, e é ele que o estorno recebe.
    payment_intent: payment.id,
    customer: customerId,
    raw: payment,
  };
}

function refund({ provider_ref }) {
  return asaas.refundPayment(provider_ref);
}

/**
 * ⚠️ No Asaas o cancelamento é sempre IMEDIATO (DELETE). Não existe o
 * `cancel_at_period_end` do Stripe, então "vale até o fim do ciclo" tem que ser
 * guardado do lado de cá e só chamar isto quando a data chegar — senão o
 * assinante perde na hora um mês que ele já pagou.
 */
function cancelSubscription(subscriptionId) {
  return asaas.cancelSubscription(subscriptionId);
}

/**
 * Quantos MESES dura um ciclo do Asaas.
 *
 * A plataforma só cria `MONTHLY`, mas uma assinatura pode ter o ciclo trocado
 * no painel — e cair num default de 1 mês nesse caso encurtaria a janela de
 * quem paga por ano, zerando a cota do bot doze vezes mais do que devia.
 */
const CYCLE_MONTHS = Object.freeze({
  WEEKLY: 0.25,
  BIWEEKLY: 0.5,
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUALLY: 6,
  YEARLY: 12,
});

/**
 * A janela do ciclo vigente.
 *
 * ⚠️ O ASAAS NÃO TEM `current_period_start` / `current_period_end` — só
 * `nextDueDate` e `cycle`. É por isso que a janela é DERIVADA aqui, e não lida:
 * o fim do ciclo que acabou de ser pago é o vencimento do PRÓXIMO, e o começo é
 * um ciclo antes dele.
 *
 * Pedir esses campos ao Asaas (que é o que o caminho do Stripe fazia) devolve
 * `undefined` nos dois, e o efeito é mudo: o contador de tokens do bot nunca
 * ganha âncora e a cota do assinante nunca zera.
 */
async function getSubscriptionPeriod(subscriptionId) {
  const sub = await asaas.getSubscription(subscriptionId);
  const next = sub && sub.nextDueDate ? new Date(`${sub.nextDueDate}T00:00:00-03:00`) : null;
  if (!next || Number.isNaN(next.getTime())) return { period_start: null, period_end: null };

  const months = CYCLE_MONTHS[String(sub.cycle || "MONTHLY").toUpperCase()] ?? 1;
  const start = new Date(next.getTime());
  if (months >= 1) {
    start.setMonth(start.getMonth() - Math.round(months));
  } else {
    start.setDate(start.getDate() - Math.round(months * 30));
  }
  return { period_start: start, period_end: next };
}

module.exports = {
  PROVIDER,
  UNSUPPORTED_FIELDS,
  BILLING_TYPE,
  DUE_DAYS,
  resolveReturnUrl,
  buildDescription,
  createCheckout,
  refund,
  cancelSubscription,
  getSubscriptionPeriod,
  CYCLE_MONTHS,
};
