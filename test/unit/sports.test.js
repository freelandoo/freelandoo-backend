const test = require("node:test");
const assert = require("node:assert/strict");
const { SPORTS, parseSport } = require("../../src/utils/sports");

test("chaves únicas, ASCII e cabem na coluna (VARCHAR 24)", () => {
  const keys = SPORTS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) {
    assert.match(k, /^[a-z_]+$/);
    assert.ok(k.length <= 24);
  }
});

test("os pedidos do Alex estão na lista", () => {
  for (const k of ["academia", "futebol", "basquete", "beach_tenis"]) assert.ok(parseSport(k), k);
});

test("parseSport aceita caixa/espaço e recusa o resto sem lançar", () => {
  assert.equal(parseSport(" Futebol "), "futebol");
  assert.equal(parseSport("xadrez"), null);
  assert.equal(parseSport(null), null);
  assert.equal(parseSport({}), null);
});
