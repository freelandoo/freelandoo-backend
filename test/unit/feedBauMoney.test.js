// Conta do Baú de doação (mig 460): 5% da doação, tarifa do MP, 5% do saque.
const test = require("node:test");
const assert = require("node:assert");
const { splitBau } = require("../../src/utils/feedBauMoney");

test("R$ 100 com tarifa de R$ 1: 5% + 1 + 5% do resto", () => {
  const m = splitBau({ grossCents: 10000, processorFeeCents: 100 });
  assert.deepStrictEqual(m, {
    gross_cents: 10000,
    platform_fee_cents: 500,
    processor_fee_cents: 100,
    received_cents: 9400,
    withdraw_fee_cents: 470,
    net_cents: 8930,
    processor_estimated: false,
  });
});

test("tarifa não apurada (null) ≠ zero: marca estimado", () => {
  const m = splitBau({ grossCents: 10000, processorFeeCents: null });
  assert.strictEqual(m.processor_estimated, true);
  assert.strictEqual(m.net_cents, 9025);
});

test("R$ 1 e R$ 1 milhão fecham a soma sem centavo perdido", () => {
  for (const g of [100, 100000000, 12345]) {
    const m = splitBau({ grossCents: g, processorFeeCents: 3 });
    assert.strictEqual(m.platform_fee_cents + m.processor_fee_cents + m.withdraw_fee_cents + m.net_cents, g);
    assert.ok(m.net_cents >= 0);
  }
});

test("tarifa maior que o valor não deixa líquido negativo", () => {
  const m = splitBau({ grossCents: 100, processorFeeCents: 9999 });
  assert.strictEqual(m.net_cents, 0);
  assert.strictEqual(m.platform_fee_cents + m.processor_fee_cents + m.withdraw_fee_cents + m.net_cents, 100);
});
