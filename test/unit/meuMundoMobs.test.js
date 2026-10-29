// Invasões de monstros no centro (mm3d-48b): quando e onde nascem, no máximo 2,
// andam em volta do ponto, somem no tempo e saem da cidade quando alguém vence
// estando perto.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoCenter");
const { resolveCircle } = require("../../src/utils/meuMundoMotion");
const { MobDirector, MOBS } = require("../../src/realtime/meuMundoMobs");

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
const make = (seed = 1) => new MobDirector({ isFree, rng: seeded(seed), now: 0 });

test("lugares de nascer: muitos, todos livres com a volta inteira", () => {
  const d = make();
  assert.ok(d.spots.length > 40, `poucos lugares: ${d.spots.length}`);
  for (const p of d.spots) assert.ok(isFree(p.x, p.z, MOBS.RADIUS + MOBS.WANDER_R), `${p.x},${p.z}`);
});

test("a primeira invasão sai entre 1 e 2 minutos; nunca mais de 2 vivos; longe de quem está perto", () => {
  const d = make(7);
  const me = { x: 0, z: -20 };
  assert.equal(d.tick(59_000, [me], 0.05), false);
  let t = 0;
  let max = 0;
  while (t < 3_600_000) {
    t += 1000;
    d.tick(t, [me], 1);
    max = Math.max(max, d.mobs.size);
    for (const m of d.mobs.values()) assert.ok(Math.hypot(m.cx - me.x, m.cz - me.z) >= MOBS.FAR_FROM_PLAYER);
  }
  assert.ok(max >= 1 && max <= MOBS.MAX_ALIVE, `máximo vivo: ${max}`);
  assert.ok(d.seq >= 5, `invasões em 1 h: ${d.seq}`);
});

test("anda em volta do ponto e some depois de 10 minutos", () => {
  const d = make(3);
  const m = d.forceSpawn(0, []);
  assert.ok(m);
  for (let i = 1; i <= 100; i++) {
    d.tick(i * 100, [], 0.1);
    assert.ok(Math.abs(Math.hypot(m.x - m.cx, m.z - m.cz) - MOBS.WANDER_R) < 1e-6);
  }
  const row = d.list()[0];
  assert.deepEqual(row.slice(0, 2), [m.id, m.kind]);
  d.tick(MOBS.LIFE_MS + 1, [], 0.1);
  assert.equal(d.get(m.id), null);
});

test("vitória só vale para quem está perto; depois o monstro sai da lista", () => {
  const d = make(5);
  const m = d.forceSpawn(0, []);
  assert.equal(d.claim(m.id, m.x + 40, m.z), null, "longe demais");
  assert.equal(d.claim(999, m.x, m.z), null, "monstro que não existe");
  assert.equal(d.claim(m.id, m.x + 2, m.z).id, m.id);
  assert.equal(d.list().length, 0);
  assert.equal(d.claim(m.id, m.x, m.z), null, "duas vitórias no mesmo monstro");
});
