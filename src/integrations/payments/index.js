// src/integrations/payments/index.js
// O PaymentGateway: a porta única de cobrança da plataforma.
//
// ─── O QUE ESTE MÓDULO RESOLVE ──────────────────────────────────────────────
//
// Antes dele, ~20 pontos do backend chamavam o StripeService direto, cada um
// falando a língua do Stripe. Trocar de provedor exigiria mexer nos 20. Agora
// eles falam com o contrato, e QUEM é o provedor vira uma variável de ambiente.
//
// ─── A ORDEM DAS TRÊS ESCRITAS É O DESENHO ──────────────────────────────────
//
// 1. a intenção nasce no NOSSO banco       (antes de qualquer rede)
// 2. a cobrança é criada no gateway
// 3. a referência do gateway é carimbada na intenção
//
// Invertida, uma falha de rede no meio do passo 2 deixaria a cobrança de pé no
// gateway sem linha nenhuma aqui — e o webhook chegaria com uma referência que
// não existe no nosso banco: pagamento cobrado, sem dono e sem entrega.
//
// Nesta ordem o pior caso é o inverso e é inofensivo: uma intenção `created`
// que nunca virou cobrança, que aparece no radar de presas e some sozinha do
// caminho de quem paga.

const pool = require("../../databases");
const PaymentIntentStorage = require("../../storages/PaymentIntentStorage");
const { assertPaymentFlow, isRecurringFlow } = require("../../utils/paymentFlows");
const { assertNoUnsupportedFields } = require("./contract");
const stripeProvider = require("./providers/stripe");
const asaasProvider = require("./providers/asaas");
const asaasClient = require("./asaasClient");
const { createLogger } = require("../../utils/logger");

const log = createLogger("PaymentGateway");

const PROVIDERS = Object.freeze({
  stripe: stripeProvider,
  asaas: asaasProvider,
});

/**
 * Quem cobra.
 *
 * ⚠️ O FALLBACK PARA STRIPE NÃO É TIMIDEZ — é o que impede o deploy de derrubar
 * o caixa. Pedir `asaas` sem `ASAAS_API_KEY` configurada deixaria TODOS os 18
 * fluxos sem conseguir cobrar, e o sintoma só apareceria no primeiro clique de
 * compra, em produção. Enquanto a credencial não existir, o Stripe segue.
 */
function providerName() {
  const wanted = String(process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (wanted === "asaas") {
    if (asaasClient.isConfigured()) return "asaas";
    log.warn("provider.asaas_unconfigured_fallback_stripe");
    return "stripe";
  }
  if (wanted === "stripe") return "stripe";
  return asaasClient.isConfigured() ? "asaas" : "stripe";
}

function activeProvider() {
  return PROVIDERS[providerName()];
}

/**
 * O `flow` vem de `metadata.type`, que os 20 chamadores já mandavam.
 *
 * ⚠️ Derivar em vez de exigir um campo novo é o que permite migrar os fluxos
 * sem reescrever cada um deles — e `assertPaymentFlow` transforma o que era uma
 * string livre e sem validação numa lista fechada. Um erro de digitação que
 * antes produzia uma cobrança PAGA que nenhum confirmador reconhecia agora
 * falha no clique, com o dinheiro ainda no bolso de quem ia pagar.
 */
function resolveFlow(req) {
  return req.flow || req.payload?.type || req.metadata?.type;
}

/**
 * Cria a cobrança e devolve um objeto com a forma de uma Checkout Session:
 * `{ id, url, ... }`. É essa forma que os chamadores já gravam como
 * `stripe_session_id` e que o webhook usa para achar o pedido de volta.
 */
async function createCheckout(req = {}) {
  const flow = resolveFlow(req);
  assertPaymentFlow(flow);

  const provider = activeProvider();
  assertNoUnsupportedFields(req, provider.UNSUPPORTED_FIELDS, provider.PROVIDER);

  const payload = req.payload || req.metadata || {};
  const recurring = req.recurring ?? isRecurringFlow(flow);
  const id_user = req.id_user || payload.user_id || req.clientReferenceId || null;
  const amount_cents = Math.round(Number(req.amount_cents) || 0);

  // (1) a intenção, antes da rede.
  const intent = await PaymentIntentStorage.create(pool, {
    provider: provider.PROVIDER,
    flow,
    id_user,
    payload,
    amount_cents,
    currency: req.currency || "BRL",
  });
  const intentId = intent.id_payment_intent;

  // O Asaas não cobra desconhecido: exige um cliente com nome e CPF.
  let customerId = req.customerId || null;
  if (provider.PROVIDER === "asaas") {
    const AsaasCustomerService = require("../../services/AsaasCustomerService");
    customerId = await AsaasCustomerService.ensureCustomer(id_user);
  }

  // (2) a cobrança no gateway.
  const session = await provider.createCheckout(
    { ...req, flow, recurring, payload, amount_cents },
    { intentId, customerId }
  );

  // (3) o carimbo da referência.
  const providerRef = session.provider_ref || session.id;
  await PaymentIntentStorage.attachProviderRef(pool, intentId, {
    provider_ref: providerRef,
    provider_customer_id:
      customerId ||
      (typeof session.customer === "string" ? session.customer : session.customer?.id) ||
      null,
  });

  log.info("checkout.created", {
    provider: provider.PROVIDER,
    flow,
    intent_id: intentId,
    amount_cents,
  });

  // `intent_id` viaja junto para quem quiser auditar, sem atrapalhar quem só lê
  // `.id` e `.url` — que é o que os 20 chamadores fazem hoje.
  return { ...session, intent_id: intentId, provider: provider.PROVIDER };
}

/**
 * De quem é esta referência: do Stripe ou do Asaas?
 *
 * ⚠️ NÃO DÁ PARA DECIDIR PELO PREFIXO, e esse é o detalhe que estraga a
 * tentativa óbvia: a assinatura do Asaas e a do Stripe começam AMBAS com
 * `sub_`. Rotear por prefixo mandaria o cancelamento de uma assinatura do Asaas
 * para o Stripe, que responderia "não encontrado" — e o assinante seguiria
 * sendo cobrado todo mês depois de ter cancelado.
 *
 * Quem sabe é a intenção (mig 231), que guarda o par (provider, provider_ref).
 *
 * ⚠️ Não achar significa STRIPE, não "desconhecido": toda cobrança anterior a
 * esta migração foi feita lá e não tem intenção nenhuma. É também o caso do
 * `pi_...` do Stripe, que nunca é gravado como `provider_ref` (lá a referência
 * é a session, `cs_...`).
 */
async function resolveProviderByRef(ref) {
  if (!ref) return "stripe";
  for (const name of Object.keys(PROVIDERS)) {
    const intent = await PaymentIntentStorage.getByProviderRef(pool, name, ref);
    if (intent) return intent.provider;
  }
  return "stripe";
}

/**
 * Estorno TOTAL, no provedor que cobrou.
 *
 * ⚠️ O provedor sai da INTENÇÃO, nunca do ambiente. Uma cobrança feita no
 * Stripe precisa ser estornada no Stripe mesmo depois de a plataforma inteira
 * ter migrado para o Asaas — ler `providerName()` aqui mandaria o pedido de
 * estorno para o gateway errado, que responderia "não encontrado", e o dinheiro
 * ficaria com a gente.
 */
async function refund({ intent_id, provider_ref, payment_intent_id, provider }) {
  let resolvedProvider = provider;
  let ref = provider_ref;

  if (intent_id) {
    const intent = await PaymentIntentStorage.getById(pool, intent_id);
    if (intent) {
      resolvedProvider = intent.provider;
      ref = ref || intent.provider_ref;
    }
  }

  if (!resolvedProvider) {
    resolvedProvider = await resolveProviderByRef(payment_intent_id || ref);
  }

  const impl = PROVIDERS[resolvedProvider] || PROVIDERS.stripe;
  // No Asaas a cobrança É a referência: não existe o par charge/payment_intent
  // do Stripe, então o estorno recebe o mesmo id nos dois campos.
  return impl.refund({
    provider_ref: ref || payment_intent_id,
    payment_intent_id,
  });
}

/**
 * Cancela a assinatura NO PROVEDOR QUE A CRIOU.
 *
 * ⚠️ `immediate` só significa alguma coisa no Stripe. No Asaas o cancelamento é
 * sempre imediato (DELETE) — não existe `cancel_at_period_end`. Quem depende de
 * "vale até o fim do ciclo" precisa guardar a data do lado de cá e só chamar
 * isto quando ela chegar, senão o assinante perde na hora um mês já pago.
 */
async function cancelSubscription(subscriptionId, { provider, immediate = false } = {}) {
  const resolved = provider || (await resolveProviderByRef(subscriptionId));
  const impl = PROVIDERS[resolved] || PROVIDERS.stripe;
  return impl.cancelSubscription(subscriptionId, { immediate });
}

/**
 * A janela do ciclo vigente de uma assinatura, NO PROVEDOR QUE A CRIOU.
 *
 * ⚠️ Como o estorno, o provedor sai da INTENÇÃO e nunca do ambiente: uma
 * assinatura criada no Stripe continua tendo o ciclo lido lá depois da
 * plataforma inteira migrar.
 *
 * Existe porque os dois provedores respondem isto de formas incompatíveis — o
 * Stripe entrega `current_period_start/end` prontos, o Asaas só tem
 * `nextDueDate` + `cycle` e a janela precisa ser derivada. Quem consome (hoje o
 * Atendimento IA, para zerar a cota de tokens do bot a cada renovação) não pode
 * ter que saber dessa diferença: perguntar `current_period_start` ao Asaas
 * devolve `undefined` e a cota nunca zera, sem erro nenhum.
 */
async function getSubscriptionPeriod(subscriptionId, { provider } = {}) {
  if (!subscriptionId) return { period_start: null, period_end: null };
  const resolved = provider || (await resolveProviderByRef(subscriptionId));
  const impl = PROVIDERS[resolved] || PROVIDERS.stripe;
  if (typeof impl.getSubscriptionPeriod !== "function") {
    return { period_start: null, period_end: null };
  }
  return impl.getSubscriptionPeriod(subscriptionId);
}

module.exports = {
  PROVIDERS,
  providerName,
  resolveProviderByRef,
  activeProvider,
  resolveFlow,
  createCheckout,
  refund,
  cancelSubscription,
  getSubscriptionPeriod,
};
