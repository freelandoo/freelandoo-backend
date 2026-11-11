// Lore v2 N4 — o deus solto: quem caça quem, quando solta, a ficha 2× na luta e o
// modo deus do MobDirector (anda de dia, sente a presa sem cone, corre mais que ela,
// alcança, perdeu = paz, caiu = sai da sala).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoCenter");
const { resolveCircle } = require("../../src/utils/meuMundoMotion");
const { MobDirector } = require("../../src/realtime/meuMundoMobs");
const G = require("../../src/utils/meuMundoGodHunt");
const St = require("../../src/utils/meuMundoStatue");
const F = require("../../src/utils/meuMundoFight");

const seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const isFree = (x, z, r) => C.isSafeSpot(x, z, resolveCircle, r);
const collide = (x, z, r) => resolveCircle(x, z, r, C.OBSTACLES);
const day = () => false;
const make = (seed = 3) => new MobDirector({ isFree, collide, night: day, rng: seeded(seed), now: 0 });

test("cada deus caça a raça oposta ao povo dele", () => {
  assert.equal(G.GODS.aurion.clan, "raposa");
  assert.equal(G.GODS.aurion.prey, "vampiro");
  assert.equal(G.GODS.morkhan.clan, "vampiro");
  assert.equal(G.GODS.morkhan.prey, "raposa");
  assert.equal(G.godOfClan("raposa").id, "aurion");
  assert.ok(G.isPrey("aurion", "vampiro"));
  assert.ok(!G.isPrey("aurion", "raposa"));
  assert.ok(!G.isPrey("aurion", null));
  assert.ok(!G.isPrey("zeus", "vampiro"));
});

test("o bairro só recebe o deus que caça o povo dele; o centro, os dois", () => {
  assert.ok(G.showsIn("aurion", "vampiro"));
  assert.ok(!G.showsIn("aurion", "raposa"));
  assert.ok(G.showsIn("morkhan", null));
  assert.ok(G.showsIn("aurion", null));
});

test("solta na semana seguinte: no fim do domingo da estátua (segunda 00:00 de Brasília)", () => {
  const week = "2026-11-15";
  const at = G.looseAtFor(week);
  assert.equal(at, St.sundayEndsAt(week));
  assert.equal(new Date(at).toISOString(), "2026-11-16T03:00:00.000Z");
});

test("mais rápido que os monstros e que a corrida do jogador", () => {
  const { MOBS } = require("../../src/realtime/meuMundoMobs");
  assert.ok(G.HUNT.CHASE_V > MOBS.CHASE_V);
  assert.ok(G.HUNT.CHASE_V > 3.5);
});

test("luta: o deus tem 2× a ficha de quem enfrenta (vida, acerto, velocidade, ataque, defesa)", () => {
  assert.equal(G.GOD_PEER, 2);
  const base = { level: 1, hero: 4, seed: 7, stats: { strength: 300, speed: 280, intelligence: 250, dexterity: 260 }, body: "vampiro" };
  for (const god of G.GOD_IDS) {
    const f = new F.Fight({ ...base, kind: G.GODS[god].kind, god });
    const m = f.mobs[0];
    assert.equal(f.mobs.length, 1, "um contra um");
    assert.equal(m.hpMax, Math.round(f.me.hpMax * 2));
    for (const k of ["acc", "spd", "atk", "def"]) assert.ok(Math.abs(m.rate[k] - f.rate[k] * 2) < 1e-9, `${god} ${k}`);
  }
  // sem `god` a luta é a de sempre (ticket antigo não muda)
  const plain = new F.Fight({ ...base, kind: "cavaleiro", tier: "arena" });
  const before = new F.Fight({ ...base, kind: "cavaleiro", tier: "arena", god: "zeus" });
  assert.equal(plain.mobs[0].hpMax, before.mobs[0].hpMax);
});

test("o deus nasce na sala, anda de dia e só caça a presa", () => {
  const d = make();
  d.setGods([{ god: "aurion", prey: "vampiro" }], null);
  const far = [{ sid: "r", x: 0, z: 0, clan: "raposa" }];
  let r = d.tickGods(1000, far, 0.05);
  assert.ok(r.changed);
  const g = d.getGod("aurion");
  assert.ok(g, "nasceu de dia");
  assert.ok(Math.hypot(g.x, g.z) >= G.HUNT.FAR_FROM_PLAYER - 0.01, "longe de quem está na sala");
  // uma raposa colada nele não é caçada
  const raposa = [{ sid: "r", x: g.x + 3, z: g.z, clan: "raposa" }];
  d.tickGods(1100, raposa, 0.05);
  assert.equal(g.mode, "walk");
  // um vampiro perto (sem cone: de costas também) é caçado
  const vamp = [{ sid: "v", x: g.x - 10, z: g.z, clan: "vampiro" }];
  d.tickGods(1200, vamp, 0.05);
  assert.equal(g.mode, "chase");
  assert.equal(g.target, "v");
});

test("caça a 4,4 m/s: alcança quem corre (3,5 m/s) e abre a luta (gcatch)", () => {
  const d = new MobDirector({ isFree, collide: (x, z) => ({ x, z }), night: day, rng: seeded(5), now: 0 });
  d.setGods([{ god: "morkhan", prey: "raposa" }], null);
  d.tickGods(0, [], 0.05);
  const g = d.getGod("morkhan");
  g.x = 0;
  g.z = 0;
  const p = { sid: "r", x: 12, z: 0, clan: "raposa" };
  let caught = null;
  let t = 0;
  for (let i = 0; i < 1000 && !caught; i++) {
    p.x += 3.5 * 0.05; // foge correndo em linha reta
    t += 0.05;
    const r = d.tickGods(i * 50, [p], 0.05);
    if (r.caught.length) caught = r.caught[0];
  }
  assert.ok(caught, "alcançou");
  assert.ok(t < 16, `em ${t.toFixed(1)} s`);
  assert.deepEqual(caught, { sid: "r", god: "morkhan" });
  assert.equal(d.getGod("morkhan").mode, "fight");
  assert.equal(d.listGods()[0][0], "morkhan");
  assert.equal(d.listGods()[0][4], 2);
});

test("perdeu = paz por um tempo; ocupado = paz mais curta; caiu = sai da sala", () => {
  const d = make(9);
  d.setGods([{ god: "aurion", prey: "vampiro" }], null);
  d.tickGods(0, [], 0.05);
  const g = d.getGod("aurion");
  g.mode = "fight";
  g.target = "v";
  g.fightAt = 0;
  assert.ok(d.releaseGod("aurion", "v", 1000));
  assert.equal(g.mode, "walk");
  assert.equal(d.godCalm.get("v"), 1000 + G.HUNT.CALM_MS);
  // em paz: colado nele e não é caçado
  d.tickGods(2000, [{ sid: "v", x: g.x + 2, z: g.z, clan: "vampiro" }], 0.05);
  assert.equal(g.mode, "walk");
  d.releaseGod("aurion", "w", 3000, true);
  assert.equal(d.godCalm.get("w"), 3000 + G.HUNT.BUSY_MS);
  // caiu: some e não renasce mesmo antes da lista nova chegar
  assert.ok(d.removeGod("aurion"));
  d.tickGods(4000, [], 0.05);
  assert.equal(d.getGod("aurion"), null);
  // lista sem ele: sai; bairro de raposas não recebe Aurion
  d.setGods([{ god: "aurion", prey: "vampiro" }], "raposa");
  d.tickGods(5000, [], 0.05);
  assert.equal(d.gods.size, 0);
});

test("quem sai da sala solta o deus (a paz de quem perdeu fica)", () => {
  const d = make(11);
  d.setGods([{ god: "aurion", prey: "vampiro" }], null);
  d.tickGods(0, [], 0.05);
  const g = d.getGod("aurion");
  g.mode = "chase";
  g.target = "v";
  d.godCalm.set("v", 99999);
  d.drop("v");
  assert.equal(g.mode, "walk");
  assert.ok(d.godCalm.has("v"));
});
