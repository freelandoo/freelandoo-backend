// 2026-11-03 — nível de AVENTURA de quem joga: vida, defesa, ataque e atributos sobem a cada nível.
const test = require("node:test");
const assert = require("node:assert");
const F = require("../../src/utils/meuMundoFight");

test("nível 1 é exatamente como era (100 de vida, sem defesa, sem bônus)", () => {
  assert.deepEqual(F.heroLevelScale(1), { hp: 100, def: 0, dmg: 1, attr: 0 });
  const f = new F.Fight({ kind: "wolf", level: 1, seed: 7 });
  assert.equal(f.me.hp, 100);
  assert.equal(f.me.hpMax, 100);
  assert.equal(f.def, 0);
});

test("todo level up aumenta vida, defesa, ataque e atributos (até o 60)", () => {
  let prev = F.heroLevelScale(1);
  for (let l = 2; l <= 60; l++) {
    const s = F.heroLevelScale(l);
    assert.ok(s.hp > prev.hp && s.dmg > prev.dmg && s.attr > prev.attr, `nível ${l}`);
    assert.ok(s.def >= prev.def && s.def <= F.HERO_LEVEL.defMax);
    prev = s;
  }
  assert.deepEqual(F.heroLevelScale(99), F.heroLevelScale(60));
  assert.equal(F.heroLevelScale(10).hp, 181);
});

test("a luta usa o nível: vida máxima, defesa somada ao equipamento com teto", () => {
  const f = new F.Fight({ kind: "golem", level: 1, seed: 1, hero: 20, gear: { def: 0.25 } });
  assert.equal(f.me.hpMax, F.heroLevelScale(20).hp);
  assert.equal(f.me.hp, f.me.hpMax);
  assert.ok(Math.abs(f.def - Math.min(F.DEF_MAX, 0.25 + F.heroLevelScale(20).def)) < 1e-9);
  const top = new F.Fight({ kind: "golem", seed: 1, hero: 60, gear: { def: 0.25 } }).def;
  assert.ok(Math.abs(top - 0.545) < 1e-9 && top <= F.DEF_MAX);
  // ataque: o mesmo atributo bate mais forte com nível maior
  const a = new F.Fight({ kind: "golem", seed: 1, hero: 1 });
  const b = new F.Fight({ kind: "golem", seed: 1, hero: 10 });
  assert.ok(b.fx.dmg > a.fx.dmg * 2);
});

test("monstro do MESMO nível pede quase os mesmos golpes que no nível 1", () => {
  // golpes para cair (vida ÷ dano levado) e para derrubar (vida do monstro ÷ meu dano)
  const ratio = (l) => {
    const h = F.heroLevelScale(l);
    const m = F.mobLevelScale(l);
    return { survive: h.hp / 100 / (m.dmg * (1 - h.def)), kill: m.hp / h.dmg };
  };
  for (const l of [5, 10, 20, 40, 60]) {
    const r = ratio(l);
    assert.ok(r.survive > 0.6 && r.survive < 1.6, `aguenta no ${l}: ${r.survive}`);
    assert.ok(r.kill > 0.6 && r.kill < 1.6, `derruba no ${l}: ${r.kill}`);
  }
});

test("replay com o nível chega ao mesmo resultado (o servidor confere com o ticket)", () => {
  const setup = { kind: "soldier", level: 1, seed: 11, hero: 15 };
  const frames = [[60 * 60, 0, 127, 2]];
  const r1 = F.replayFight(setup, frames);
  const r2 = F.replayFight(setup, frames);
  assert.deepEqual(r1, r2);
});
