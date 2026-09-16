// A conta do dinheiro do delivery entre vizinhos (mig 248).
//
// *Unit* e não e2e de propósito: `courierNet`, `estimateProcessorFee` e
// `courierNetPreview` são funções PURAS — elas não precisam de Postgres, e a
// regra que protegem (o líquido que nunca fica negativo) é aritmética, não
// estado.
//
// ⚠️ NENHUM NÚMERO LÍQUIDO É CRAVADO AQUI. A mesma corrida de R$3 rende R$2,49
// no Stripe cartão (o que roda hoje) e R$1,01 no Asaas Pix (o escolhido, hoje
// desligado). Um teste que afirmasse "R$1,01" ficaria vermelho no dia do
// switch por estar CERTO — então o que se testa é a CONTA.

const test = require("node:test");
const assert = require("node:assert");

const {
  DELIVERY_KINDS,
  FALLBACK_PRICES,
  isDeliveryKind,
  estimateProcessorFee,
  courierNet,
  courierNetPreview,
  STRIKE_LIMIT,
  STRIKE_WINDOW_DAYS,
  STRIKE_BLOCK_HOURS,
} = require("../../src/utils/deliveryPricing");

// As duas réguas reais, apuradas em 2026-09-16. Elas entram como ENTRADA do
// teste, nunca como resultado esperado.
const STRIPE_CARTAO = {
  processor_fee_percent_fallback: 3.99,
  processor_fee_fixed_cents_fallback: 39,
};
const ASAAS_PIX = {
  processor_fee_percent_fallback: 0,
  processor_fee_fixed_cents_fallback: 199,
};

test("os quatro tipos de corrida são lista fechada", () => {
  assert.deepStrictEqual([...DELIVERY_KINDS], ["food", "parcel", "moving", "bulky"]);
  assert.ok(isDeliveryKind("food"));
  assert.ok(!isDeliveryKind("helicoptero"));
  assert.ok(!isDeliveryKind(null));
  assert.ok(!isDeliveryKind(""));
});

test("o fallback de preço CONCORDA com o seed da migration (não inventa um terceiro número)", () => {
  // Banco sem a linha é banco quebrado; zero significaria corrida de graça.
  assert.strictEqual(FALLBACK_PRICES.food, 300);
  assert.strictEqual(FALLBACK_PRICES.parcel, 400);
  assert.strictEqual(FALLBACK_PRICES.moving, 5000);
  assert.strictEqual(FALLBACK_PRICES.bulky, 5000);
});

test("o líquido é preço menos tarifa — a conta, em qualquer régua", () => {
  const stripe = estimateProcessorFee(300, STRIPE_CARTAO);
  assert.strictEqual(
    courierNet({ chargeAmountCents: 300, processorFeeCents: stripe.cents }),
    300 - stripe.cents
  );

  const asaas = estimateProcessorFee(300, ASAAS_PIX);
  assert.strictEqual(
    courierNet({ chargeAmountCents: 300, processorFeeCents: asaas.cents }),
    300 - asaas.cents
  );

  // E a mesma corrida rende COISAS DIFERENTES conforme quem cobra — que é
  // exatamente por que o número não pode ser cravado em lugar nenhum.
  assert.notStrictEqual(stripe.cents, asaas.cents);
});

test("⚠️ O LÍQUIDO NUNCA É NEGATIVO — seria débito na carteira de quem trabalhou", () => {
  // Tarifa fixa maior que o preço: a subtração crua daria -200.
  assert.strictEqual(courierNet({ chargeAmountCents: 300, processorFeeCents: 500 }), 0);
  // Caso limite: tarifa exatamente igual ao preço.
  assert.strictEqual(courierNet({ chargeAmountCents: 300, processorFeeCents: 300 }), 0);
  // Entrada torta não vira número negativo por acidente.
  assert.strictEqual(courierNet({ chargeAmountCents: null, processorFeeCents: 199 }), 0);
  assert.strictEqual(courierNet({ chargeAmountCents: 300, processorFeeCents: -100 }), 300);
});

test("a tela de quem entrega recebe o LÍQUIDO junto do bruto", () => {
  const p = courierNetPreview(5000, STRIPE_CARTAO);
  assert.strictEqual(p.gross_cents, 5000);
  assert.ok(p.estimated_fee_cents > 0);
  assert.strictEqual(p.net_cents, p.gross_cents - p.estimated_fee_cents);
  // Se o card anuncia o bruto e cai o líquido, o vizinho descobre na primeira
  // corrida e não faz a segunda — por isso os dois números viajam juntos.
  assert.ok(p.net_cents < p.gross_cents);
});

test("corrida de graça não produz tarifa nem líquido negativo", () => {
  const p = courierNetPreview(0, STRIPE_CARTAO);
  assert.strictEqual(p.gross_cents, 0);
  assert.strictEqual(p.estimated_fee_cents, 0);
  assert.strictEqual(p.net_cents, 0);
});

test("régua ausente não inventa tarifa (estimativa zero, nunca NaN)", () => {
  const p = courierNetPreview(300, undefined);
  assert.strictEqual(p.estimated_fee_cents, 0);
  assert.strictEqual(p.net_cents, 300);
});

test("o freio do cancelamento está calibrado onde o brief o deixou", () => {
  // Mexer nestes números quebra o teste, e é para quebrar: eles são a decisão
  // registrada ("3 cancelamentos em 7 dias bloqueiam aceitar por 24h").
  assert.strictEqual(STRIKE_LIMIT, 3);
  assert.strictEqual(STRIKE_WINDOW_DAYS, 7);
  assert.strictEqual(STRIKE_BLOCK_HOURS, 24);
});
