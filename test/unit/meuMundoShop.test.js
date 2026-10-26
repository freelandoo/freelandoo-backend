// Vendedor do centro (mm3d-37e): preços das casas e cores do carro.
const test = require("node:test");
const assert = require("node:assert/strict");
const Shop = require("../../src/utils/meuMundoShop");
const { MAX_LEVEL } = require("../../src/utils/meuMundoLayout");

test("casa: subir paga o nível novo, descer é de graça, preço cresce com o nível", () => {
  assert.equal(Shop.housePrice(1, 2), Shop.HOUSE_PRICES[2]);
  assert.equal(Shop.housePrice(5, 2), 0);
  assert.equal(Shop.housePrice(1, 99), null);
  for (let n = 2; n <= 9; n++) assert.ok(Shop.HOUSE_PRICES[n] > Shop.HOUSE_PRICES[n - 1], `nível ${n}`);
  assert.ok(Object.keys(Shop.HOUSE_PRICES).every((n) => Number(n) <= MAX_LEVEL));
});

test("carro: vermelho de fábrica e grátis, cores únicas com formato do CHECK", () => {
  assert.equal(Shop.DEFAULT_PAINT, "vermelho");
  assert.equal(Shop.PAINT_BY_ID.get("vermelho").price, 0);
  const ids = Shop.CAR_PAINTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of Shop.CAR_PAINTS) {
    assert.match(p.id, /^[a-z0-9-]{1,32}$/);
    assert.match(p.hex, /^#[0-9A-F]{6}$/);
  }
  assert.equal(Shop.paintOf("azul"), "azul");
  assert.equal(Shop.paintOf("inventada"), "vermelho");
  assert.equal(Shop.paintOf(null), "vermelho");
});
