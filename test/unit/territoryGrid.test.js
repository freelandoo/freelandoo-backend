// test/unit/territoryGrid.test.js
// Gerador da planta do condomínio (D10). É lógica pura, então é testável sem
// banco — o resto do TerritoryService depende de Postgres e é coberto pelo
// smoke e2e.
const test = require("node:test");
const assert = require("node:assert");

const TerritoryService = require("../../src/services/TerritoryService");

test("grid sem torres: andares × apartamentos, numeração brasileira", () => {
  const g = TerritoryService.buildUnitGrid({ floors: 2, perFloor: 3 });
  assert.strictEqual(g.length, 6);
  assert.deepStrictEqual(
    g.map((u) => u.label),
    ["101", "102", "103", "201", "202", "203"],
  );
  assert.ok(g.every((u) => u.id_block === null));
});

test("grid com torres: multiplica por bloco", () => {
  const g = TerritoryService.buildUnitGrid({ floors: 2, perFloor: 2, blockIds: [7, 9] });
  assert.strictEqual(g.length, 8);
  assert.strictEqual(g.filter((u) => u.id_block === 7).length, 4);
  assert.strictEqual(g.filter((u) => u.id_block === 9).length, 4);
});

test("numeração passa de 9 apartamentos por andar sem colidir", () => {
  const g = TerritoryService.buildUnitGrid({ floors: 1, perFloor: 12 });
  const labels = g.map((u) => u.label);
  assert.strictEqual(labels[9], "110");
  assert.strictEqual(labels[11], "112");
  assert.strictEqual(new Set(labels).size, 12);
});

test("entrada zero ou negativa é elevada ao mínimo de 1", () => {
  assert.strictEqual(TerritoryService.buildUnitGrid({ floors: 0, perFloor: 0 }).length, 1);
  assert.strictEqual(TerritoryService.buildUnitGrid({ floors: -5, perFloor: -5 }).length, 1);
});

test("entrada absurda é capada (não deixa gerar planta infinita)", () => {
  const g = TerritoryService.buildUnitGrid({ floors: 9999, perFloor: 9999 });
  assert.strictEqual(g.length, 200 * 50);
});

test("grid não colide consigo mesmo dentro do mesmo bloco", () => {
  const g = TerritoryService.buildUnitGrid({ floors: 30, perFloor: 8 });
  const keys = g.map((u) => `${u.id_block}|${u.label}`);
  assert.strictEqual(new Set(keys).size, keys.length);
});
