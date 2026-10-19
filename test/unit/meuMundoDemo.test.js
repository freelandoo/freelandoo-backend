const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDemoNeighborhood } = require("../../src/utils/meuMundoDemo");

test("bairro demonstrativo tem exatamente 20 lotes, um por casa", () => {
  const { neighborhood } = buildDemoNeighborhood();
  assert.equal(neighborhood.lots.length, 20);
  assert.equal(neighborhood.houses.length, 20);
  const numbers = neighborhood.lots.map((l) => l.number);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => i + 1));
  for (const lot of neighborhood.lots) {
    const house = neighborhood.houses.find((h) => h.id === lot.houseId);
    assert.ok(house, `casa do ${lot.id}`);
    assert.equal(house.lotId, lot.id);
  }
});

test("identificadores são estáveis entre chamadas", () => {
  const a = buildDemoNeighborhood().neighborhood;
  const b = buildDemoNeighborhood().neighborhood;
  assert.deepEqual(a, b);
  assert.equal(a.lots[0].id, "lot-01");
  assert.equal(a.lots[19].houseId, "house-20");
});

test("demonstração não atribui casa a ninguém", () => {
  const { neighborhood } = buildDemoNeighborhood();
  for (const h of neighborhood.houses) {
    assert.equal(h.ownerId, null);
    assert.equal(h.level, 1);
  }
});

test("quatro quadras de cinco, sem lotes sobrepostos", () => {
  const { neighborhood } = buildDemoNeighborhood();
  const sides = {};
  for (const l of neighborhood.lots) sides[l.side] = (sides[l.side] || 0) + 1;
  assert.deepEqual(sides, { north: 5, east: 5, south: 5, west: 5 });
  const keys = new Set(neighborhood.lots.map((l) => `${l.position.x},${l.position.z}`));
  assert.equal(keys.size, 20);
});
