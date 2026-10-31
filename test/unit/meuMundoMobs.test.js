// Invasões de monstros (mm3d-48b/57b): só de noite, no máximo 2, andam em volta
// do ponto, perseguem quem fica de frente, alcançam e abrem a luta, somem no
// tempo e saem da cidade quando alguém vence.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoCenter");
const L = require("../../src/utils/meuMundoLayout");
const { resolveCircle } = require("../../src/utils/meuMundoMotion");
const { MobDirector, MOBS, isNight } = require("../../src/realtime/meuMundoMobs");

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
const always = () => true;
const make = (seed = 1, night = always) => new MobDirector({ isFree, collide, night, rng: seeded(seed), now: 0 });

test("noite pelo relógio de Brasília: 18h–6h", () => {
  const at = (h) => Date.UTC(2026, 9, 30, (h + 3) % 24, 0);
  assert.equal(isNight(at(12)), false);
  assert.equal(isNight(at(17)), false);
  assert.equal(isNight(at(18)), true);
  assert.equal(isNight(at(23)), true);
  assert.equal(isNight(at(3)), true);
  assert.equal(isNight(at(6)), false);
});

test("lugares de nascer: muitos, todos livres com a volta inteira (centro e bairro)", () => {
  const d = make();
  const spots = d.spots();
  assert.ok(spots.length > 40, `poucos lugares: ${spots.length}`);
  for (const p of spots) assert.ok(isFree(p.x, p.z, MOBS.RADIUS + MOBS.WANDER_R), `${p.x},${p.z}`);
  const nbFree = (x, z, r) => L.isSafeSpot(x, z, resolveCircle, r);
  const nb = new MobDirector({ isFree: nbFree, span: 80, night: always, rng: seeded(2), now: 0 });
  assert.ok(nb.spots().length > 40, `poucos lugares no bairro: ${nb.spots().length}`);
});

test("de dia não nasce nenhum; escureceu = primeiro entre 1 e 2 min; ao amanhecer vão embora", () => {
  let night = false;
  const d = new MobDirector({ isFree, collide, night: () => night, rng: seeded(4), now: 0 });
  for (let t = 0; t <= 3_600_000; t += 1000) d.tick(t, [], 1);
  assert.equal(d.seq, 0, "nasceu de dia");
  night = true;
  const dusk = 3_601_000;
  let first = 0;
  for (let t = dusk; t <= dusk + 130_000; t += 1000) {
    d.tick(t, [], 1);
    if (!first && d.mobs.size) first = t - dusk;
  }
  assert.ok(first >= 60_000 && first <= 121_000, `primeiro aos ${first} ms`);
  night = false;
  const r = d.tick(dusk + 131_000, [], 0.05);
  assert.equal(r.changed, true);
  assert.equal(d.mobs.size, 0);
});

test("nunca mais de 2 vivos; nasce longe de quem está perto", () => {
  const d = make(7);
  const me = { sid: "a", x: 0, z: -20 };
  let max = 0;
  for (let t = 0; t < 3_600_000; t += 1000) {
    const { caught } = d.tick(t, [me], 1);
    for (const c of caught) d.release(c.id, c.sid, t);
    max = Math.max(max, d.mobs.size);
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

/** Põe a pessoa a `dist` m na frente (ou atrás) do focinho do monstro. */
const inFront = (m, dist, back = false) => {
  const f = m.facing + (back ? Math.PI : 0);
  return { x: m.x + Math.sin(f) * dist, z: m.z + Math.cos(f) * dist };
};

test("quem fica de frente é perseguido, alcançado e a luta abre; de costas, não", () => {
  const d = make(5);
  const m = d.forceSpawn(0, []);
  d.tick(100, [], 0.1);
  const behind = { sid: "b", ...inFront(m, 6, true) };
  d.tick(200, [behind], 0.05);
  assert.equal(m.mode, "wander", "viu pelas costas");
  const me = { sid: "a", ...inFront(m, 8) };
  d.tick(300, [me], 0.05);
  assert.equal(m.mode, "chase");
  assert.equal(m.target, "a");
  let caught = [];
  for (let t = 350; t < 10_000 && !caught.length; t += 50) caught = d.tick(t, [me], 0.05).caught;
  assert.deepEqual(caught, [{ sid: "a", id: m.id, kind: m.kind }]);
  assert.equal(m.mode, "fight");
  // Lutando: fica parado, ninguém mais é perseguido por ele, não some no tempo.
  const x = m.x;
  m.born = -MOBS.LIFE_MS;
  d.tick(m.fightAt + 1000, [me, behind], 0.05);
  assert.equal(m.x, x);
  assert.ok(d.get(m.id));
  // Luta sem resposta por 5 min: volta a andar (e aí o tempo de vida conta).
  d.tick(m.fightAt + MOBS.FIGHT_MS + 1, [me], 0.05);
  assert.equal(d.get(m.id), null);
});

test("correndo escapa (desiste a 22 m); quem saiu da sala solta o monstro", () => {
  const d = make(6);
  const m = d.forceSpawn(0, []);
  d.tick(100, [], 0.1);
  const me = { sid: "a", ...inFront(m, 10) };
  d.tick(200, [me], 0.05);
  assert.equal(m.mode, "chase");
  const run = Math.atan2(me.x - m.x, me.z - m.z);
  for (let t = 250; t < 30_000 && m.mode === "chase"; t += 50) {
    me.x += Math.sin(run) * MOBS.CHASE_V * 1.1 * 0.05 * 3; // mais rápido que ele
    me.z += Math.cos(run) * MOBS.CHASE_V * 1.1 * 0.05 * 3;
    d.tick(t, [me], 0.05);
  }
  assert.equal(m.mode, "wander");
  m.mode = "chase";
  m.target = "a";
  d.drop("a");
  assert.equal(m.mode, "wander");
});

test("derrota: o monstro volta a andar e quem perdeu fica 30 s em paz", () => {
  const d = make(8);
  const m = d.forceSpawn(0, []);
  assert.ok(d.engage(m.id, "a", m.x, m.z, 0));
  assert.equal(d.engage(m.id, "b", m.x, m.z, 0), null, "dois lutando com o mesmo");
  assert.equal(d.release(m.id, "a", 1000), true);
  assert.equal(m.mode, "wander");
  const me = { sid: "a", ...inFront(m, 5) };
  d.tick(1100, [me], 0.05);
  assert.equal(m.mode, "wander", "perseguiu quem acabou de perder");
  d.tick(1000 + MOBS.CALM_MS + 100, [{ sid: "a", ...inFront(m, 5) }], 0.05);
  assert.equal(m.mode, "chase");
});

test("vitória: vale para quem luta ou está perto; depois o monstro sai da lista", () => {
  const d = make(5);
  const m = d.forceSpawn(0, []);
  assert.equal(d.claim(m.id, m.x + 40, m.z), null, "longe demais");
  assert.equal(d.claim(999, m.x, m.z), null, "monstro que não existe");
  assert.equal(d.claim(m.id, m.x + 2, m.z).id, m.id);
  assert.equal(d.list().length, 0);
  assert.equal(d.claim(m.id, m.x, m.z), null, "duas vitórias no mesmo monstro");
  const n = d.forceSpawn(0, []);
  d.engage(n.id, "a", n.x, n.z, 0);
  assert.equal(d.claim(n.id, n.x, n.z, "b"), null, "venceu a luta de outro");
  assert.equal(d.claim(n.id, n.x + 40, n.z, "a").id, n.id);
});
