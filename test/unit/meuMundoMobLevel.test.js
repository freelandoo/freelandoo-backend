// mm3d-60m — nível dos monstros da rua: sorteio em volta do jogador e status pelo nível.
const test = require("node:test");
const assert = require("node:assert");
const A = require("../../src/utils/meuMundoAdventure");
const F = require("../../src/utils/meuMundoFight");

function seq(seed) {
  let x = seed >>> 0;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test("níveis 1–3 iguais aos de antes (a Arena usa)", () => {
  for (const l of [1, 2, 3]) {
    const s = F.mobLevelScale(l);
    assert.ok(Math.abs(s.hp - (1 + 0.45 * (l - 1))) < 1e-9);
    assert.ok(Math.abs(s.dmg - (1 + 0.3 * (l - 1))) < 1e-9);
    assert.ok(Math.abs(s.poise - 2 * (l - 1)) < 1e-9);
  }
});

test("status do monstro crescem com o nível e param no 60", () => {
  let prev = F.mobLevelScale(3);
  for (const l of [4, 10, 30, 60]) {
    const s = F.mobLevelScale(l);
    assert.ok(s.hp > prev.hp && s.dmg > prev.dmg && s.poise > prev.poise);
    prev = s;
  }
  assert.deepEqual(F.mobLevelScale(99), F.mobLevelScale(60));
  const f = new F.Fight({ kind: "wolf", level: 20, seed: 3 });
  assert.equal(f.level, 20);
  assert.equal(f.mobs[0].hpMax, Math.round(F.MOBS.wolf.hp * F.mobLevelScale(20).hp));
  assert.equal(new F.Fight({ kind: "soldier", level: 9, seed: 3 }).level, 2);
});

test("sorteio: às vezes abaixo, quase sempre perto, às vezes muito acima", () => {
  const r = seq(42);
  const offs = Array.from({ length: 8000 }, () => A.rollMobLevel(20, r) - 20);
  const share = (fn) => offs.filter(fn).length / offs.length;
  assert.ok(Math.min(...offs) >= -5 && Math.max(...offs) <= 20);
  assert.ok(Math.abs(share((o) => o <= -2) - 0.15 * 0.8) < 0.04);
  assert.ok(share((o) => o >= 7) > 0.07 && share((o) => o >= 7) < 0.13);
  assert.ok(share((o) => Math.abs(o) <= 1) > 0.5);
  // nunca abaixo de 1 nem acima de 60
  assert.ok(Array.from({ length: 500 }, () => A.rollMobLevel(1, r)).every((l) => l >= 1));
  assert.ok(Array.from({ length: 500 }, () => A.rollMobLevel(58, r)).every((l) => l <= 60));
});

test("monstro nasce com nível em volta de quem está na sala e manda o nível na lista", () => {
  const { MobDirector } = require("../../src/realtime/meuMundoMobs");
  const d = new MobDirector({ isFree: () => true, collide: (x, z) => ({ x, z }), span: 60, test: false });
  d.spots = () => [{ x: 40, z: 40 }];
  const lv = [];
  for (let i = 0; i < 300; i++) {
    d.mobs.clear();
    const m = d.spawn(Date.now(), [{ sid: "a", x: 0, z: 0, lv: 30 }, { sid: "b", x: 1, z: 0, lv: 10 }]);
    lv.push(m.level);
  }
  assert.ok(lv.every((l) => l >= 15 && l <= 40), JSON.stringify([Math.min(...lv), Math.max(...lv)]));
  assert.equal(d.list()[0].length, 6);
  assert.equal(d.list()[0][5], d.mobs.values().next().value.level);
  d.mobs.clear();
  assert.ok(d.spawn(Date.now(), [{ sid: "a", x: 0, z: 0 }]).level >= 1);
});
