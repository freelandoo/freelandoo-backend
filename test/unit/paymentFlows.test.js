// test/unit/paymentFlows.test.js
//
// A lista fechada dos fluxos de pagamento. É *unit* de propósito: são funções
// puras sobre um mapa, e o que elas seguram é o fio que, no Asaas, liga a
// cobrança ao que ela significa — lá viaja um `externalReference` só, e fluxo
// torto vira dinheiro cobrado que nenhum confirmador reconhece.
//
// O caso que mais importa é o do INVENTÁRIO: se um `metadata.type` que existe
// no código do Stripe não estiver declarado aqui, aquele fluxo migra e para de
// ser entregue — em silêncio, porque a criação da cobrança funciona.
const test = require("node:test");
const assert = require("node:assert");

const {
  PAYMENT_FLOWS,
  FLOW_KEYS,
  isPaymentFlow,
  isRecurringFlow,
  assertPaymentFlow,
} = require("../../src/utils/paymentFlows");

// O inventário levantado do StripeWebhookService + dos 20 pontos de criação de
// sessão em 2026-09-09. Fluxo novo no código entra aqui JUNTO — se este teste
// quebrar numa entrega futura, a pergunta certa é "o confirmador existe?", não
// "como faço o teste passar?".
const INVENTARIO_STRIPE = [
  "profile_activation", "polen_purchase", "xp_boost", "premium",
  "manifestation", "function_purchase", "course_purchase",
  "profile_product_order", "casa_participant_order", "booking_deposit",
  "clan_slot", "community_slot", "condo_listing_slot", "donation",
  "plan_subscription", "community_membership", "vaquinha_sponsorship",
  "atendimento_ia",
];

test("todo metadata.type do Stripe está declarado", () => {
  for (const flow of INVENTARIO_STRIPE) {
    assert.ok(isPaymentFlow(flow), `fluxo ausente da lista: ${flow}`);
  }
});

test("a lista não cresceu sem passar por aqui", () => {
  assert.deepStrictEqual([...FLOW_KEYS].sort(), [...INVENTARIO_STRIPE].sort());
});

test("os quatro recorrentes são exatamente os que viram assinatura no Asaas", () => {
  // Trava de calibração deliberada: mexer nisto muda a CHAMADA no Asaas
  // (/subscriptions em vez de /payments) e, em Pix/boleto, muda o que o
  // cliente precisa fazer todo mês. É para quebrar.
  assert.deepStrictEqual(
    FLOW_KEYS.filter(isRecurringFlow).sort(),
    ["atendimento_ia", "community_membership", "plan_subscription", "vaquinha_sponsorship"]
  );
});

test("fluxo desconhecido é recusado na CRIAÇÃO, não no webhook", () => {
  assert.throws(() => assertPaymentFlow("polen_purchse"), /desconhecido/i);
  assert.throws(() => assertPaymentFlow(""), /desconhecido/i);
  assert.throws(() => assertPaymentFlow(null), /desconhecido/i);
  assert.throws(() => assertPaymentFlow({ flow: "premium" }), /desconhecido/i);
});

test("assertPaymentFlow devolve o fluxo para encadear", () => {
  assert.strictEqual(assertPaymentFlow("premium"), "premium");
});

test("herança de prototype não vira fluxo válido", () => {
  // `Object.hasOwn` e não `in`: com `in`, "toString" e "constructor" passariam
  // por fluxo válido e chegariam ao gateway como referência externa.
  assert.strictEqual(isPaymentFlow("toString"), false);
  assert.strictEqual(isPaymentFlow("constructor"), false);
  assert.strictEqual(isRecurringFlow("hasOwnProperty"), false);
});

test("todo fluxo declara recurring booleano e label não-vazio", () => {
  for (const [flow, meta] of Object.entries(PAYMENT_FLOWS)) {
    assert.strictEqual(typeof meta.recurring, "boolean", `${flow}.recurring`);
    assert.ok(meta.label && meta.label.trim().length > 0, `${flow}.label`);
  }
});
