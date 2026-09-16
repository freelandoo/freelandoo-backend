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
//
// ─── ⚠️ QUEM COBRA HOJE: MERCADO PAGO. O ASAAS SAIU INTEIRO ─────────────────
//
// O Asaas foi construído inteiro (mig 236 + auditoria A1–A6) e NUNCA COBROU UM
// REAL: conferido em produção que `tb_payment_intent` está vazia — nenhuma
// cobrança passou por este gateway, em nenhum provedor. Foi esse fato que
// permitiu removê-lo de uma vez em vez de mantê-lo como saída do passado: não
// havia dinheiro dele para devolver. (Mesmo critério da mig 247 com a
// Evolution: não havia ninguém para deixar sem canal.)
//
// O motivo de ele sair é tarifa: R$1,99 FIXO por Pix é 66% de uma corrida de
// R$3 e 20% de uma função de R$9,90. Como praticamente nenhum ticket da
// Freelandoo passa de R$150, o ponto em que a tarifa fixa ganha da percentual
// (~R$201) nunca é alcançado.
//
// ─── ⚠️ E O STRIPE: LEGADO, AINDA COBRANDO ATÉ O MP TER CREDENCIAL ──────────
//
// Ele NÃO foi arrancado, e isso é deliberado — por dois motivos, nesta ordem:
//
// 1. Arrancá-lo antes de o Mercado Pago estar configurado FECHA O CAIXA. Todos
//    os fluxos ficariam sem conseguir cobrar, e o sintoma apareceria no
//    primeiro clique de compra, em produção. É a mesma razão pela qual a
//    migração do Asaas manteve o fallback.
// 2. Existem 5 assinaturas de perfil ATIVAS com assinatura recorrente viva no
//    Stripe (conferido em produção). Elas são cobradas LÁ, todo mês,
//    independente do nosso código — arrancar o adapter não para a cobrança, só
//    nos deixa cegos e sem conseguir cancelar.
//
// Assim que `MERCADOPAGO_ACCESS_TOKEN` existir, o Mercado Pago passa a cobrar
// TUDO sozinho, sem deploy novo, e o Stripe fica só como porta de estorno e
// cancelamento do que já foi cobrado nele.

const pool = require("../../databases");
const PaymentIntentStorage = require("../../storages/PaymentIntentStorage");
const { assertPaymentFlow, isRecurringFlow } = require("../../utils/paymentFlows");
const { assertNoUnsupportedFields } = require("./contract");
const stripeProvider = require("./providers/stripe");
const mercadoPagoProvider = require("./providers/mercadopago");
const mp = require("./mercadoPagoClient");
const { createLogger } = require("../../utils/logger");

const log = createLogger("PaymentGateway");

/**
 * Todos os provedores que a plataforma sabe OPERAR — cobrar, estornar,
 * cancelar, apurar taxa.
 *
 * ⚠️ `asaas` não está aqui e o valor CONTINUA aceito nos CHECKs do banco (mig
 * 250), como `evolution` continua no CHECK do WhatsApp. Um provedor removido do
 * registry com o valor vivo na constraint é o desenho certo: a constraint
 * descreve o que a coluna pode conter ao longo da vida do banco, o registry
 * descreve quem opera hoje.
 */
const PROVIDERS = Object.freeze({
  mercadopago: mercadoPagoProvider,
  stripe: stripeProvider,
});

/**
 * Quem cobra.
 *
 * ⚠️ O FALLBACK PARA STRIPE NÃO É TIMIDEZ — é o que impede o deploy de derrubar
 * o caixa. Pedir `mercadopago` sem `MERCADOPAGO_ACCESS_TOKEN` configurado
 * deixaria TODOS os fluxos sem conseguir cobrar, e o sintoma só apareceria no
 * primeiro clique de compra, em produção. Enquanto a credencial não existir, o
 * Stripe segue.
 *
 * ⚠️ O WARN é alto de propósito: fallback silencioso é como uma migração fica
 * pela metade por semanas sem ninguém notar.
 */
function providerName() {
  const wanted = String(process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();

  if (wanted === "stripe") return "stripe";

  if (wanted === "mercadopago" || wanted === "mp") {
    if (mp.isConfigured()) return "mercadopago";
    log.warn("provider.mercadopago_unconfigured_fallback_stripe");
    return "stripe";
  }

  // Sem `PAYMENT_PROVIDER` declarado, quem decide é a CREDENCIAL — a regra das
  // migs 214/220/223: quem diz se o provedor existe é a ENV, não a flag.
  if (mp.isConfigured()) return "mercadopago";
  log.warn("provider.mercadopago_missing_using_legacy_stripe");
  return "stripe";
}

function activeProvider() {
  return PROVIDERS[providerName()];
}

/** Em qual ambiente o provedor ativo está. Só para diagnóstico de boot. */
function activeEnvironment() {
  return providerName() === "mercadopago" ? mp.environment() : "stripe";
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

  // ⚠️ NENHUM CLIENTE PRÉ-CADASTRADO, e é um ganho do Mercado Pago sobre o
  // Asaas: lá era obrigatório criar um `customer` com nome e CPF antes de
  // cobrar (é a razão da mig 236 e da coluna `asaas_customer_id`). Aqui o
  // pagador vai inline na preferência, então o fluxo perdeu uma ida à rede, uma
  // tabela de espelho e a dependência do CPF estar preenchido.
  const customerId = req.customerId || null;

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
 * De quem é esta referência?
 *
 * ⚠️ NÃO DÁ PARA DECIDIR PELO PREFIXO, e esse é o detalhe que estraga a
 * tentativa óbvia: ids de assinatura de provedores diferentes colidem de forma
 * silenciosa (a do Asaas e a do Stripe começavam AMBAS com `sub_`). Rotear por
 * prefixo mandaria o cancelamento de uma assinatura para o gateway errado, que
 * responderia "não encontrado" — e o assinante seguiria sendo cobrado todo mês
 * depois de ter cancelado.
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
 * migrar para o Mercado Pago — ler `providerName()` aqui mandaria o pedido de
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
  // No Mercado Pago, como era no Asaas, a cobrança É a referência: não existe o
  // par charge/payment_intent do Stripe, então o estorno recebe o mesmo id nos
  // dois campos.
  return impl.refund({
    provider_ref: ref || payment_intent_id,
    payment_intent_id,
  });
}

/**
 * Cancela a assinatura NO PROVEDOR QUE A CRIOU.
 *
 * ⚠️ `immediate` só significa alguma coisa no Stripe. No Mercado Pago o
 * cancelamento é sempre imediato (PUT status=cancelled) — não existe
 * `cancel_at_period_end`. Quem depende de "vale até o fim do ciclo" agenda a
 * data em `tb_subscription_end` (mig 251) e só chega aqui quando ela vence.
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
 * Existe porque os provedores respondem isto de formas incompatíveis — o Stripe
 * entrega `current_period_start/end` prontos, o Mercado Pago só tem
 * `next_payment_date` + `auto_recurring` e a janela precisa ser derivada. Quem
 * consome (hoje o Atendimento IA, para zerar a cota de tokens do bot a cada
 * renovação) não pode ter que saber dessa diferença: perguntar
 * `current_period_start` ao Mercado Pago devolve `undefined` e a cota nunca
 * zera, sem erro nenhum.
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

/**
 * A taxa REAL cobrada pelo provedor, e o id da cobrança.
 *
 * ⚠️ O provedor sai da INTENÇÃO, como no estorno: uma venda antiga feita no
 * Stripe continua tendo a taxa apurada lá. Ler `providerName()` aqui
 * perguntaria ao gateway errado e a venda ficaria para sempre na taxa estimada.
 *
 * Devolve `{ fee_cents: null }` quando não dá para apurar — e quem chama tem
 * que MANTER a estimativa nesse caso, nunca assumir zero.
 */
async function getChargeFee(provider_ref, { provider } = {}) {
  if (!provider_ref) return { fee_cents: null, charge_id: null, source: null };
  const resolved = provider || (await resolveProviderByRef(provider_ref));
  const impl = PROVIDERS[resolved] || PROVIDERS.stripe;
  if (typeof impl.getChargeFee !== "function") {
    return { fee_cents: null, charge_id: null, source: null };
  }
  return impl.getChargeFee(provider_ref);
}

module.exports = {
  PROVIDERS,
  providerName,
  resolveProviderByRef,
  activeProvider,
  activeEnvironment,
  resolveFlow,
  createCheckout,
  refund,
  cancelSubscription,
  getSubscriptionPeriod,
  getChargeFee,
};
