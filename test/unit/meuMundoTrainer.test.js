// test/unit/meuMundoTrainer.test.js — lore v2 F2: curva e ganho do nível do treinador.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../src/utils/meuMundoTrainer");

test("nível 1 com zero; a curva sobe sempre e o custo nunca cai", () => {
  assert.deepEqual(T.trainerLevelOf(0), { level: 1, into: 0, need: T.xpForLevel(2), total: 0 });
  let prevNeed = 0;
  for (let L = 1; L <= 60; L++) {
    const need = T.xpForLevel(L + 1) - T.xpForLevel(L);
    assert.ok(need >= prevNeed, `custo do nível ${L} (${need}) < anterior (${prevNeed})`);
    prevNeed = need;
  }
});

test("trainerLevelOf bate com a tabela nas bordas", () => {
  for (const L of [2, 3, 5, 8, 11, 14, 17, 20, 23, 27, 30, 45]) {
    const at = T.trainerLevelOf(T.xpForLevel(L));
    assert.equal(at.level, L);
    assert.equal(at.into, 0);
    assert.equal(T.trainerLevelOf(T.xpForLevel(L) - 1).level, L - 1);
  }
});

test("calibração: nível 30 ≈ missões dos 10 capítulos (~7.540) + ~10 semanas no ritmo de 600", () => {
  const n30 = T.xpForLevel(30);
  assert.ok(n30 > 12000 && n30 < 15000, String(n30));
  // capítulo 2 (nível 3) não abre só com as missões do capítulo 1 (220): precisa de jogo
  assert.ok(T.xpForLevel(3) > 220 + T.GAIN.dailyCap * 2);
  assert.equal(T.trainerTable(30).length, 30);
});

test("fração por fonte e teto do dia", () => {
  assert.equal(T.shareOf("minigame", 10), 10);
  assert.equal(T.shareOf("fight", 45), 11);
  assert.equal(T.shareOf("domain", 100), 25);
  assert.equal(T.shareOf("quest", 100), 0); // missão não é fração: entra inteira por fora
  assert.equal(T.capRoom(0), T.GAIN.dailyCap);
  assert.equal(T.capRoom(T.GAIN.dailyCap + 50), 0);
});

test("cuidar/treinar: só horas úteis inteiras e refeições até o limite", () => {
  assert.deepEqual(T.dayUnits({ hours: { training: 2.5, studying: 1.2 }, mealsEaten: 2 }), { meals: 2, hours: 3 });
  // treino passa das 4 h úteis, estudo das 5: conta só 9
  assert.deepEqual(T.dayUnits({ hours: { training: 7, studying: 8 }, mealsEaten: 6 }), { meals: 3, hours: 9 });
  assert.deepEqual(T.dayUnits(null), { meals: 0, hours: 0 });
});
