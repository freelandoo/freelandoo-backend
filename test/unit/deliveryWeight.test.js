// test/unit/deliveryWeight.test.js
//
// O delivery por peso (mig 266): faixas, direções e o fallback. Unit porque
// as funções só precisam de um `conn` com `query`.
const test = require("node:test");
const assert = require("node:assert");

const {
  WEIGHT_BANDS,
  FALLBACK_BANDS,
  isWeightBand,
  isDeliveryDirection,
  kindForBand,
  listWeightBands,
  getWeightBand,
} = require("../../src/utils/deliveryPricing");

const connWith = (rows) => ({ query: async () => ({ rows }) });
const connThatFails = () => ({
  query: async () => {
    throw new Error("conexão caiu");
  },
});

test("as cinco faixas e as duas direções são listas fechadas", () => {
  assert.deepStrictEqual([...WEIGHT_BANDS], ["w1", "w3", "w6", "w10", "w10p"]);
  assert.ok(isWeightBand("w3"));
  assert.ok(!isWeightBand("w99"));
  assert.ok(!isWeightBand(undefined));
  assert.ok(isDeliveryDirection("send"));
  assert.ok(isDeliveryDirection("receive"));
  assert.ok(!isDeliveryDirection("levar"));
});

test("o fallback concorda com o que o Alex ditou: 3 · 5 · 15 · 20 e acima de 10 kg negocia", () => {
  const by = Object.fromEntries(FALLBACK_BANDS.map((b) => [b.band, b]));
  assert.strictEqual(by.w1.min_cents, 300);
  assert.strictEqual(by.w3.min_cents, 500);
  assert.strictEqual(by.w6.min_cents, 1500);
  assert.strictEqual(by.w10.min_cents, 2000);
  assert.strictEqual(by.w10p.negotiable, true);
  assert.ok(FALLBACK_BANDS.filter((b) => b.band !== "w10p").every((b) => b.negotiable === false));
});

test("carga negociada herda os prazos de volumoso; o resto, de encomenda", () => {
  assert.strictEqual(kindForBand("w10p"), "bulky");
  assert.strictEqual(kindForBand("w1"), "parcel");
  assert.strictEqual(kindForBand("w10"), "parcel");
});

test("a tabela manda; banco fora do ar cai no fallback em vez de corrida de graça", async () => {
  const fromDb = await listWeightBands(connWith([{ band: "w1", min_cents: 999, negotiable: false }]));
  assert.strictEqual(fromDb[0].min_cents, 999);
  const down = await listWeightBands(connThatFails());
  assert.strictEqual(down.length, 5);
  assert.strictEqual((await getWeightBand(connThatFails(), "w6")).min_cents, 1500);
  assert.strictEqual(await getWeightBand(connThatFails(), "xx"), null);
});
