// A conta do dinheiro da VENDA na vitrine do vizinho (mig 249).
//
// *Unit* porque `computeOrder`, `platformFeeFor` e `splitProcessorFee` são
// funções PURAS — a regra que elas protegem (as quatro partes fechando o que o
// comprador pagou) é aritmética, não estado.
//
// ⚠️ NENHUM NÚMERO DE TARIFA É CRAVADO. A mesma venda rende coisas diferentes
// conforme quem cobra (Stripe cartão hoje; Asaas Pix quando a credencial subir).
// A tarifa entra como ENTRADA do teste, nunca como resultado esperado.

const test = require("node:test");
const assert = require("node:assert");

const {
  FALLBACK_SETTINGS,
  platformFeeFor,
  splitProcessorFee,
  computeOrder,
} = require("../../src/utils/listingOrder");

/** As quatro partes têm que somar exatamente o que o comprador pagou. */
function fecha(c) {
  return (
    c.platform_fee_cents + c.processor_fee_cents + c.seller_cents + c.courier_cents ===
    c.amount_cents
  );
}

test("a régua nasce com taxa ZERO e holdback de 8 dias (CDC)", () => {
  // A taxa zero é decisão registrada: o Alex pediu o checkout e nunca falou em
  // taxa sobre a venda entre vizinhos.
  assert.strictEqual(FALLBACK_SETTINGS.platform_fee_cents, 0);
  assert.strictEqual(FALLBACK_SETTINGS.platform_fee_percent, 0);
  // ⚠️ E o holdback VOLTA aqui — é o oposto do delivery, de propósito.
  assert.strictEqual(FALLBACK_SETTINGS.holdback_days, 8);
});

test("⚠️ AS QUATRO PARTES FECHAM o que o comprador pagou", () => {
  for (const caso of [
    { priceCents: 5000, deliveryCents: 300, platformFeeCents: 0, processorFeeCents: 250 },
    { priceCents: 3000, deliveryCents: 0, platformFeeCents: 150, processorFeeCents: 158 },
    { priceCents: 20000, deliveryCents: 5000, platformFeeCents: 500, processorFeeCents: 1036 },
    { priceCents: 333, deliveryCents: 300, platformFeeCents: 0, processorFeeCents: 7 },
    { priceCents: 1, deliveryCents: 300, platformFeeCents: 0, processorFeeCents: 199 },
  ]) {
    const c = computeOrder(caso);
    assert.ok(fecha(c), `não fechou: ${JSON.stringify({ caso, c })}`);
  }
});

test("a tarifa do gateway é RATEADA entre produto e entrega", () => {
  const c = computeOrder({
    priceCents: 20000,
    deliveryCents: 300,
    platformFeeCents: 0,
    processorFeeCents: 1036,
  });
  // Jogada inteira no entregador, uma corrida de R$3 dentro de uma compra de
  // R$200 viraria prejuízo — a tarifa percentual do produto comeria a entrega.
  assert.ok(c.delivery_fee_cents > 0);
  assert.ok(c.delivery_fee_cents < c.processor_fee_cents);
  // O rateio é proporcional: a entrega é ~1,5% do total, então a parte dela na
  // tarifa é pequena.
  assert.ok(c.delivery_fee_cents < c.price_fee_cents);
});

test("⚠️ A SOBRA DOS CENTAVOS TEM DONO — as duas partes somam a tarifa exata", () => {
  // Sem regra explícita, o arredondamento deixaria 1 centavo sem dono e as
  // partes somariam mais (ou menos) que a tarifa cobrada.
  for (let fee = 0; fee <= 60; fee++) {
    const r = splitProcessorFee({ processorFeeCents: fee, priceCents: 333, deliveryCents: 300 });
    assert.strictEqual(
      r.price_fee_cents + r.delivery_fee_cents,
      fee,
      `não somou em fee=${fee}: ${JSON.stringify(r)}`
    );
    assert.ok(r.price_fee_cents >= 0 && r.delivery_fee_cents >= 0);
  }
});

test("sem add-on, a tarifa inteira fica com o produto", () => {
  const r = splitProcessorFee({ processorFeeCents: 250, priceCents: 5000, deliveryCents: 0 });
  assert.strictEqual(r.delivery_fee_cents, 0);
  assert.strictEqual(r.price_fee_cents, 250);
});

test("⚠️ NENHUM LÍQUIDO NEGATIVO — seria débito na carteira de quem entregou", () => {
  // Produto de R$1 com tarifa fixa de R$1,99: a subtração crua daria -99.
  const c = computeOrder({
    priceCents: 100,
    deliveryCents: 0,
    platformFeeCents: 0,
    processorFeeCents: 199,
  });
  assert.strictEqual(c.seller_cents, 0);
  assert.strictEqual(c.courier_cents, 0);
  // E a tarifa é limitada ao que entrou: o gateway não fica com mais do que foi
  // cobrado — sem esse teto, as quatro partes deixariam de fechar.
  assert.strictEqual(c.processor_fee_cents, 100);
  assert.ok(fecha(c));
});

test("a taxa da plataforma nunca engole o preço inteiro", () => {
  const on = { platform_fee_cents: 99999, platform_fee_percent: 0, is_active: true };
  assert.strictEqual(platformFeeFor(1000, on), 1000);
  // Percentual + fixo somam, e o teto continua valendo.
  const both = { platform_fee_cents: 100, platform_fee_percent: 10, is_active: true };
  assert.strictEqual(platformFeeFor(1000, both), 200);
});

test("`is_active = FALSE` é o kill-switch da taxa", () => {
  const off = { platform_fee_cents: 500, platform_fee_percent: 5, is_active: false };
  assert.strictEqual(platformFeeFor(1000, off), 0);
  assert.strictEqual(platformFeeFor(1000, null), 0);
});

test("a taxa da plataforma NÃO incide sobre a entrega", () => {
  // Ela não é receita do vendedor: é o pagamento de um terceiro que vai
  // carregar a sacola. Cobrar taxa dela seria a plataforma tirando uma parte do
  // dinheiro de quem entrega — o oposto da decisão do delivery.
  const semEntrega = platformFeeFor(5000, {
    platform_fee_cents: 0,
    platform_fee_percent: 10,
    is_active: true,
  });
  const c = computeOrder({
    priceCents: 5000,
    deliveryCents: 300,
    platformFeeCents: semEntrega,
    processorFeeCents: 0,
  });
  // 10% de 5000 = 500, e não 10% de 5300 = 530.
  assert.strictEqual(c.platform_fee_cents, 500);
  assert.strictEqual(c.courier_cents, 300);
});

test("entrada torta não vira número negativo nem NaN", () => {
  const c = computeOrder({
    priceCents: null,
    deliveryCents: undefined,
    platformFeeCents: -50,
    processorFeeCents: "abc",
  });
  assert.strictEqual(c.amount_cents, 0);
  assert.strictEqual(c.seller_cents, 0);
  assert.strictEqual(c.courier_cents, 0);
  assert.ok(fecha(c));
});
