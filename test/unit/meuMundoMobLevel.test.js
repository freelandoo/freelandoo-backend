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
  // 2026-11-03: o Golem de Pedra da rua tem nível sorteado (o corte 1–2 do menu é do servidor)
  assert.equal(new F.Fight({ kind: "soldier", level: 9, seed: 3 }).level, 9);
});

test("o monstro da rua tem o nível de quem o viu", () => {
  assert.equal(A.rollMobLevel(20), 20);
  assert.equal(A.rollMobLevel(0), 1);
  assert.equal(A.rollMobLevel(99), 60);
});

test("adversário à altura: vida, dano e defesa de quem joga; Campeão com 20% a mais", () => {
  const stats = { strength: 700, speed: 400, intelligence: 500, dexterity: 300 };
  const gear = { dmg: 0.1, def: 0.1 };
  const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  for (const hero of [1, 12, 60]) {
    for (const kind of F.MOB_KINDS) {
      const k = F.peerOf(kind);
      assert.equal(k, kind === "brute" ? 1.2 : 1);
      const f = new F.Fight({ kind, level: 1, hero, seed: 9, stats, gear, peer: k });
      const total = f.mobs.reduce((a, m) => a + m.hpMax, 0);
      assert.ok(Math.abs(total - f.me.hpMax * k) <= f.mobs.length, `${kind} vida ${total}`);
      const foe = mean(F.MOBS[kind].attacks.map((a) => a.dmg)) * f.mobs[0].dmgMul;
      assert.ok(Math.abs(foe - mean(F.COMBO.map((c) => c.dmg)) * f.fx.dmg * k) < 1e-6, `${kind} dano`);
      for (const s of ["acc", "spd", "atk", "def"]) assert.ok(Math.abs(f.mobs[0].rate[s] - f.rate[s] * k) < 1e-9, `${kind} ${s}`);
    }
  }
});

test("sem peer (prólogo), o monstro segue pelo nível", () => {
  const f = new F.Fight({ kind: "soldier", level: 1, hero: 30, seed: 3 });
  assert.equal(f.mobs[0].hpMax, F.MOBS.soldier.hp);
  assert.equal(f.rated, false);
});

test("acuracidade contra velocidade, ataque contra defesa", () => {
  assert.equal(F.hitChance(100, 1000), 0.1);
  assert.equal(F.hitChance(1000, 100), 1);
  assert.equal(F.hitChance(500, 500), 1);
  assert.equal(F.hitChance(500, 1000) * 2, F.hitChance(1000, 1000));
  // apertar esquivar: 90% com muita velocidade, quase nada contra muita acuracidade
  assert.equal(F.dodgeChance(100, 1000), 0.9);
  assert.equal(F.dodgeChance(1000, 100), 0.1);
  assert.equal(F.dodgeChance(500, 500), 0.9);
  assert.equal(F.damageRatio(100, 1000), 0.1);
  assert.equal(F.damageRatio(1000, 100), 1);
  // o exemplo do Alex: golpe de 200
  assert.equal(200 * F.damageRatio(50, 100), 100);
  assert.equal(200 * F.damageRatio(50, 1000), 10);
  assert.equal(F.hitChance(10, 1000), 0.01);
  // nível 1 sem equipamento: 100 contra 100; status baixos ficam como são
  const f = new F.Fight({ kind: "soldier", seed: 1, peer: 1, stats: { strength: 50, speed: 30 } });
  assert.equal(f.rate.atk, 100);
  assert.equal(f.rate.def, 100);
  assert.equal(f.rate.acc, 50);
  assert.equal(f.rate.spd, 30);
});

test("quem tem muita velocidade escapa sozinho e o golpe não pega 2 seguidos", () => {
  const f = new F.Fight({ kind: "soldier", seed: 11, peer: 1, stats: { strength: 1000, speed: 1000 } });
  const m = f.mobs[0];
  m.rate.acc = 100;
  const a = F.MOBS.soldier.attacks[0];
  let landed = 0;
  let row = 0;
  let twice = 0;
  for (let i = 0; i < 4000; i++) {
    m.struck = false;
    m.x = f.me.x;
    m.z = f.me.z + 1;
    m.facing = Math.PI;
    m.t = 0;
    f.me.state = "idle";
    f.me.hp = f.me.hpMax;
    const before = f.me.hp;
    f.mobHit(m, a);
    const hit = f.me.hp < before;
    if (hit) landed++;
    if (hit && row) twice++;
    row = hit ? 1 : 0;
  }
  assert.equal(twice, 0);
  assert.ok(landed / 4000 > 0.05 && landed / 4000 < 0.12, `pegou ${landed}`);
});

test("monstro nasce sem nível; o PRIMEIRO que o vê define e fica para a sala", () => {
  const { MobDirector, MOBS } = require("../../src/realtime/meuMundoMobs");
  const d = new MobDirector({ isFree: () => true, collide: (x, z) => ({ x, z }), span: 60, test: false });
  d.spots = () => [{ x: 40, z: 40 }];
  const m = d.spawn(Date.now(), [{ sid: "a", x: 0, z: 0, lv: 30 }]);
  assert.equal(m.level, 0);
  assert.equal(d.list()[0][5], 0); // ninguém viu ainda: sem placa
  // longe demais: ninguém viu
  d.tick(Date.now(), [{ sid: "far", x: m.x + MOBS.SEEN_R + 5, z: m.z, lv: 50 }], 0.05);
  assert.equal(m.level, 0);
  // o primeiro que chega perto (nv 10) define; quem chega depois (nv 50) não muda
  d.tick(Date.now(), [{ sid: "b", x: m.x + 10, z: m.z, lv: 10 }, { sid: "c", x: m.x + 30, z: m.z, lv: 50 }], 0.05);
  const lv = m.level;
  assert.equal(m.seenBy, "b");
  assert.ok(lv >= 5 && lv <= 30, String(lv));
  d.tick(Date.now(), [{ sid: "c", x: m.x + 2, z: m.z, lv: 50 }], 0.05);
  assert.equal(m.level, lv);
  assert.equal(d.list()[0][5], lv);
  // nível ainda não carregado (lv 0) não define
  const d2 = new MobDirector({ isFree: () => true, collide: (x, z) => ({ x, z }), span: 60, test: false });
  d2.spots = () => [{ x: 40, z: 40 }];
  const m2 = d2.spawn(Date.now(), []);
  d2.tick(Date.now(), [{ sid: "x", x: m2.x + 3, z: m2.z, lv: 0 }], 0.05);
  assert.equal(m2.level, 0);
});
