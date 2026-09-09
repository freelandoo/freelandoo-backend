// src/utils/paymentFlows.js
// A lista FECHADA dos fluxos de pagamento da plataforma — a fonte única do que
// hoje viaja como `metadata.type` na sessão do Stripe.
//
// ─── POR QUE UMA LISTA, E POR QUE AQUI ──────────────────────────────────────
//
// O `metadata.type` nunca teve validação: era uma string que o service escrevia
// e o webhook lia. Funcionou porque os dois lados moram no mesmo repositório —
// mas um erro de digitação no service produzia um pagamento COBRADO que nenhum
// confirmador reconhecia, e o dinheiro ficava parado sem erro nenhum aparecer.
//
// Na troca para o Asaas isso deixa de ser tolerável: lá o identificador viaja
// como `externalReference` (uma string só) e é o ÚNICO fio entre a cobrança e o
// que ela significa. Fio torto = entrega perdida.
//
// Mora em utils, e não numa CHECK do banco, porque fluxo novo entra JUNTO do
// código que sabe confirmá-lo. Uma CHECK obrigaria uma migration para cada
// produto novo da loja, e a migration não sabe confirmar nada.
//
// ─── `recurring` NÃO É ENFEITE ──────────────────────────────────────────────
//
// É o que decide a chamada no Asaas: fluxo avulso vira `POST /payments`
// (cobrança), recorrente vira `POST /subscriptions` (assinatura). São objetos
// diferentes, com webhooks diferentes e cancelamento diferente. Sem esta
// marca, quem escrevesse o adapter teria que adivinhar pelo nome do fluxo.
//
// ⚠️ E carrega um aviso de produto: no Asaas só o CARTÃO cobra sozinho. Em Pix
// ou boleto a assinatura GERA a cobrança e o cliente precisa pagar cada mês —
// não é débito automático. Os quatro fluxos marcados aqui mudam de
// comportamento quando saem do Stripe, e isso é decisão de negócio, não
// detalhe de implementação.

/** @type {Record<string, { recurring: boolean, label: string }>} */
const PAYMENT_FLOWS = {
  // ── Avulsos ───────────────────────────────────────────────────────────────
  profile_activation:     { recurring: false, label: "Ativação de perfil" },
  polen_purchase:         { recurring: false, label: "Loja de Poléns" },
  xp_boost:               { recurring: false, label: "Booster de XP" },
  premium:                { recurring: false, label: "Perfil premium" },
  manifestation:          { recurring: false, label: "Manifestação" },
  function_purchase:      { recurring: false, label: "Loja de Funções" },
  course_purchase:        { recurring: false, label: "Compra de curso" },
  profile_product_order:  { recurring: false, label: "Loja de produtos" },
  casa_participant_order: { recurring: false, label: "Casa Views — conveniência" },
  booking_deposit:        { recurring: false, label: "Sinal de agendamento" },
  clan_slot:              { recurring: false, label: "Vaga de clan" },
  community_slot:         { recurring: false, label: "Vaga de comunidade" },
  condo_listing_slot:     { recurring: false, label: "Vaga de anúncio de condomínio" },
  donation:               { recurring: false, label: "Vaquinha — doação" },

  // ── Recorrentes ───────────────────────────────────────────────────────────
  plan_subscription:      { recurring: true,  label: "Plano mensal" },
  community_membership:   { recurring: true,  label: "Mensalidade de comunidade" },
  vaquinha_sponsorship:   { recurring: true,  label: "Bolsa patrocínio" },
  atendimento_ia:         { recurring: true,  label: "Atendimento IA" },
};

const FLOW_KEYS = Object.freeze(Object.keys(PAYMENT_FLOWS));

function isPaymentFlow(flow) {
  return typeof flow === "string" && Object.hasOwn(PAYMENT_FLOWS, flow);
}

function isRecurringFlow(flow) {
  return isPaymentFlow(flow) && PAYMENT_FLOWS[flow].recurring === true;
}

/**
 * Recusa fluxo desconhecido ANTES de qualquer ida ao gateway.
 *
 * ⚠️ A recusa é aqui e não no webhook de propósito: falhar na criação devolve
 * um erro para quem clicou, com o dinheiro ainda no bolso dele. Falhar no
 * webhook seria descobrir o problema com a cobrança já paga.
 */
function assertPaymentFlow(flow) {
  if (!isPaymentFlow(flow)) {
    throw new Error(`Fluxo de pagamento desconhecido: ${String(flow)}`);
  }
  return flow;
}

module.exports = {
  PAYMENT_FLOWS,
  FLOW_KEYS,
  isPaymentFlow,
  isRecurringFlow,
  assertPaymentFlow,
};
