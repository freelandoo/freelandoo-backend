// lore v2 N2: o néctar da semana — a tabela do Alex (D2) e quando a semana fecha (D6).
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../../src/utils/meuMundoNectar");

const utc = (s) => Date.parse(s);

test("N2: 1º = 10 L; 2º a 10º = 4,0 → 2,0 L (0,25 L por posição); fora do top 10 = 1 L", () => {
  assert.equal(N.mlFor(1), 10000);
  const top = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => N.mlFor(p));
  assert.deepEqual(top, [4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000]);
  assert.equal(N.mlFor(11), 1000);
  assert.equal(N.mlFor(500), 1000);
  // fora do top 10 sem pontuar = nada; no top 10 a posição basta
  assert.equal(N.mlFor(11, false), 0);
  assert.equal(N.mlFor(3, false), 3750);
  // posição inválida = nada
  for (const bad of [0, -1, NaN, null, undefined, "x"]) assert.equal(N.mlFor(bad), 0);
});

test("N2: a tabela da tela tem 11 linhas e a última é 'fora do top 10'", () => {
  assert.equal(N.TABLE.length, 11);
  assert.deepEqual(N.TABLE[0], { position: 1, outside: false, ml: 10000 });
  assert.deepEqual(N.TABLE[10], { position: 11, outside: true, ml: 1000 });
  assert.ok(Object.isFrozen(N.TABLE));
});

test("N2: os litros somam entre os jogos (1º nos 9 = 90 L)", () => {
  assert.equal(N.totalMl(Array.from({ length: 9 }, () => ({ ml: N.mlFor(1) }))), 90000);
});

test("N2: a semana fecha depois do sábado 23:59 de Brasília (D6)", () => {
  // semana 2026-11-08 → fecha domingo 2026-11-15 00:00 BRT = 03:00 UTC
  assert.equal(N.closesAt("2026-11-08"), utc("2026-11-15T03:00:00Z"));
  assert.equal(N.isClosable("2026-11-08", utc("2026-11-15T02:59:59Z")), false);
  assert.equal(N.isClosable("2026-11-08", utc("2026-11-15T03:00:00Z")), true);
  assert.equal(N.weekToClose(utc("2026-11-15T03:00:00Z")), "2026-11-08");
  assert.equal(N.weekToClose(utc("2026-11-14T12:00:00Z")), "2026-11-01");
  assert.equal(N.isClosable("2026-11-10", utc("2027-01-01T00:00:00Z")), false); // não é domingo
});
