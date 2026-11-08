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

test("status do monstro crescem com o nível, sem teto", () => {
  let prev = F.mobLevelScale(3);
  for (const l of [4, 10, 30, 60]) {
    const s = F.mobLevelScale(l);
    assert.ok(s.hp > prev.hp && s.dmg > prev.dmg && s.poise > prev.poise);
    prev = s;
  }
  assert.ok(F.mobLevelScale(99).hp > F.mobLevelScale(60).hp);
  const f = new F.Fight({ kind: "wolf", level: 20, seed: 3 });
  assert.equal(f.level, 20);
  assert.equal(f.mobs[0].hpMax, Math.round(F.MOBS.wolf.hp * F.mobLevelScale(20).hp));
  // 2026-11-03: o Golem de Pedra da rua tem nível sorteado (o corte 1–2 do menu é do servidor)
  assert.equal(new F.Fight({ kind: "soldier", level: 9, seed: 3 }).level, 9);
});

test("sorteio: 20% igual, 30% +3/+4, 20% +6 a +10, 20% +12, 10% +20", () => {
  const r = seq(42);
  const offs = Array.from({ length: 20000 }, () => A.rollMobLevel(20, r) - 20);
  const share = (fn) => offs.filter(fn).length / offs.length;
  const near = (v, p) => assert.ok(Math.abs(v - p) < 0.02, `${v} perto de ${p}`);
  near(share((o) => o === 0), 0.2);
  near(share((o) => o === 3 || o === 4), 0.3);
  near(share((o) => o >= 6 && o <= 10), 0.2);
  near(share((o) => o === 12), 0.2);
  near(share((o) => o === 20), 0.1);
  assert.ok(offs.every((o) => [0, 3, 4, 6, 7, 8, 9, 10, 12, 20].includes(o)));
  // nunca abaixo do meu nível; acima de 60 vale
  assert.ok(Array.from({ length: 500 }, () => A.rollMobLevel(1, r)).every((l) => l >= 1));
  assert.ok(Array.from({ length: 500 }, () => A.rollMobLevel(58, r)).some((l) => l > 60));
});

test("status sem teto: atributo, nível e luta passam de 1000 e de 60", () => {
  const L = require("../../src/utils/meuMundoLife");
  const s = F.heroSheet("normal", 80, { strength: 5000, speed: 5000 });
  assert.equal(s.acc, 100 + 5000 + 3 * 79);
  assert.ok(s.atk > 1000 && s.hp > 631);
  assert.ok(A.levelOf(1e9).level > 60);
  const f = new F.Fight({ kind: "soldier", seed: 3, hero: 80, peer: 1, stats: { strength: 5000, speed: 5000, intelligence: 5000, dexterity: 9000 } });
  assert.ok(f.fx.stamK > 0 && f.fx.recoverK > 0);
  assert.ok(Math.abs(F.rankOdds(5000, 9000).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(L.ATTR.CURVE_MIN > 0, "treino nunca para de render");
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
      assert.ok(Math.abs(foe - mean(F.COMBO.map((c) => c.dmg)) * f.fx.dmg) < 1e-6, `${kind} dano`);
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
  assert.equal(F.damageRatio(1000, 100), 10);
  assert.equal(200 * F.damageRatio(100, 50), 400);
  // o exemplo do Alex: golpe de 200
  assert.equal(200 * F.damageRatio(50, 100), 100);
  assert.equal(200 * F.damageRatio(50, 1000), 10);
  assert.equal(F.hitChance(10, 1000), 0.01);
  // nível 1 sem equipamento: 100 contra 100; status baixos ficam como são
  const f = new F.Fight({ kind: "soldier", seed: 1, peer: 1, stats: { strength: 50, speed: 30 } });
  assert.equal(f.rate.atk, 100);
  assert.equal(f.rate.def, 100);
  assert.equal(f.rate.acc, 150);
  assert.equal(f.rate.spd, 130);
});

test("o peso multiplica os status: com tudo em 200, o Aurion fica com 320 de vida", () => {
  const s = F.heroSheet("aurion", 1, { strength: 100, speed: 100, intelligence: 0, dexterity: 0 });
  assert.equal(s.acc, 280);
  assert.equal(s.spd, 240);
  const p = F.heroSheet("normal", 1, { strength: 100, speed: 100, intelligence: 0, dexterity: 0 });
  assert.equal(p.acc, 200);
  assert.equal(p.spd, 200);
  assert.equal(F.heroSheet("aurion", 13, { strength: 0, speed: 0 }).hp, Math.round(F.heroLevelScale(13).hp * 1.6));
  for (const b of ["sergio", "ekaterina", "female", "raposa", "raposa_f", "raposa_adulto", "raposa_adulta", "vampiro", "vampira", "vampiro_adulto", "vampira_adulta"]) assert.ok(F.BODY_SHEETS[b], b);
  for (const b of ["normal", "slim", "fat", "strong"]) assert.equal(F.BODY_SHEETS[b], undefined);
});

test("cada personagem nasce com a própria ficha", () => {
  const s = F.heroSheet("aeryn", 1, { strength: 0, speed: 0, intelligence: 0, dexterity: 0 });
  assert.deepEqual([s.hp, s.atk, s.def, s.acc, s.spd], [90, 110, 90, 180, 150]);
  const p = F.heroSheet("normal", 1, { strength: 0, speed: 0, intelligence: 0, dexterity: 0 });
  assert.deepEqual([p.hp, p.atk, p.def, p.acc, p.spd], [100, 100, 100, 100, 100]);
  const f = new F.Fight({ kind: "wolf", seed: 2, tier: "arena", body: "kragor" });
  assert.equal(f.me.hpMax, 220);
});

test("monstros pela ficha: o da rua no nível dele, o da Arena no de quem joga", () => {
  const stone = new F.Fight({ kind: "soldier", level: 1, seed: 2, tier: "street" }).mobs[0];
  assert.equal(stone.hpMax, 175);
  assert.equal(stone.rate.def, 165);
  assert.equal(stone.rate.spd, 60);
  assert.equal(new F.Fight({ kind: "soldier", seed: 2, tier: "arena" }).mobs[0].hpMax, 170);
  const wolves = new F.Fight({ kind: "wolf", seed: 2, tier: "arena" }).mobs;
  assert.equal(wolves.reduce((a, m) => a + m.hpMax, 0), 225);
  const l = new F.Fight({ kind: "brute", level: 60, hero: 1, seed: 2, tier: "street" }).mobs[0];
  assert.ok(Math.abs(l.rate.atk - 1908.6) < 0.1);
  assert.equal(new F.Fight({ kind: "brute", level: 60, hero: 1, seed: 2, tier: "arena" }).mobs[0].rate.atk, 160);
});

test("Brutamontes do nível 15 = a referência do Alex; a ficha da skin não anda junto", () => {
  const m = new F.Fight({ kind: "brute", level: 15, seed: 2, tier: "street" }).mobs[0];
  assert.equal(m.hpMax, 506);
  assert.deepEqual([m.rate.atk, m.rate.def, m.rate.acc, m.rate.spd].map(Math.round), [575, 503, 431, 323]);
  assert.deepEqual(F.BODY_SHEETS.ciborgue, [130, 130, 130, 150, 70]);
  assert.deepEqual(F.BODY_SHEETS.garras, [90, 120, 80, 160, 140]);
  assert.deepEqual(F.BODY_SHEETS.golem, [160, 110, 150, 80, 50]);
});

test("Ciborgue atira na Arena e na rua, como a skin; no ringue segue no soco", () => {
  const ids = (f) => f.mobs[0].attacks.map((x) => x.id);
  // mm3d-72: + os 4 poderes de personagem (Corte, Investida, Escudo, Poder Máximo)
  const SK = ["skSlash", "skDash", "skShield", "skUlt"];
  assert.deepEqual(ids(new F.Fight({ kind: "golem", seed: 2, tier: "arena" })), ["shot", "blast", ...SK]);
  assert.deepEqual(ids(new F.Fight({ kind: "golem", seed: 2, tier: "street" })), ["shot", "blast", ...SK]);
  assert.deepEqual(ids(new F.Fight({ kind: "golem", seed: 2, peer: 1 })), ["swipe", "slam"]);
  assert.equal(new F.Fight({ kind: "golem", seed: 2, tier: "arena" }).mobs[0].engage, 6);
});

test("o tiro é por distância: longe do alcance das mãos ele ainda pega", () => {
  const f = new F.Fight({ kind: "golem", seed: 3, tier: "arena", stats: { strength: 0, speed: 0, intelligence: 0, dexterity: 0 } });
  const idle = { mx: 0, mz: 0, run: false, attack: false, dodge: false };
  const start = f.me.hp;
  for (let i = 0; i < 60 * 8 && !f.over; i++) f.step(idle);
  assert.ok(f.me.hp < start);
  assert.ok(Math.hypot(f.mobs[0].x - f.me.x, f.mobs[0].z - f.me.z) > 3.3);
});

test("ringue não usa a curva dos monstros: o adversário segue espelho", () => {
  const f = new F.Fight({ kind: "soldier", hero: 15, seed: 2, peer: 1 });
  assert.equal(f.mobs[0].hpMax, f.me.hpMax);
  assert.equal(f.mobs[0].rate.atk, f.rate.atk);
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
