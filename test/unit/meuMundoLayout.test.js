const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/meuMundoLayout");
const { MOTION, step, sanitizeIntent, resolveCircle } = require("../../src/utils/meuMundoMotion");

const nb = () =>
  L.buildNeighborhoodPayload({
    code: "bairro-0001",
    name: "Bairro 01",
    residents: 1,
    houses: [{ number: 3, variant: L.houseVariant(3), ownerName: "alex", isMine: true }],
  });

test("bairro ring-20: 20 lotes estáveis, uma casa nível 01 por lote", () => {
  const n = nb();
  assert.equal(n.lots.length, 20);
  assert.equal(n.houses.length, 20);
  assert.deepEqual(n.lots.map((l) => l.number), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(n.lots[0].id, "lot-01");
  assert.equal(n.lots[19].houseId, "house-20");
  for (const h of n.houses) assert.equal(h.level, 1);
});

test("titular só aparece por nome público; casa livre fica disponível", () => {
  const n = nb();
  assert.equal(n.houses[2].ownerName, "alex");
  assert.equal(n.houses[2].isMine, true);
  assert.equal(n.houses[0].ownerName, null);
  assert.equal(n.houses[0].isMine, false);
  assert.ok(!JSON.stringify(n).includes("ownerId"));
});

test("frente de cada casa é um ponto livre de obstáculos", () => {
  for (let i = 1; i <= 20; i++) {
    const p = L.frontOfHouse(i);
    const r = resolveCircle(p.x, p.z, MOTION.RADIUS, L.OBSTACLES);
    assert.ok(Math.hypot(r.x - p.x, r.z - p.z) < 1e-6, `casa ${i} nasce dentro de obstáculo`);
  }
});

test("intenção da rede é normalizada e nunca acelera além do limite", () => {
  assert.equal(sanitizeIntent(null), null);
  assert.equal(sanitizeIntent({ x: "a", z: 1 }), null);
  const big = sanitizeIntent({ x: 100, z: 0, r: true });
  assert.ok(Math.abs(Math.hypot(big.x, big.z) - 1) < 1e-9);
  const b = { x: 0, z: -15, vx: 0, vz: 0, facing: 0 };
  let maxSpeed = 0;
  for (let i = 0; i < 100; i++) {
    const x0 = b.x;
    step(b, big, 0.05, [], L.LIMIT);
    maxSpeed = Math.max(maxSpeed, Math.abs(b.x - x0) / 0.05);
  }
  assert.ok(maxSpeed <= MOTION.RUN_SPEED + 1e-6, `velocidade ${maxSpeed}`);
});

test("corrida lenta é mais rápida que a caminhada e o estado acompanha", () => {
  const a = { x: 0, z: -15, vx: 0, vz: 0, facing: 0 };
  const b = { x: 0, z: -15, vx: 0, vz: 0, facing: 0 };
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 40; i++) {
    ma = step(a, { x: 0, z: -1, run: false }, 0.05, [], L.LIMIT);
    mb = step(b, { x: 0, z: -1, run: true }, 0.05, [], L.LIMIT);
  }
  assert.equal(ma, 1);
  assert.equal(mb, 2);
  assert.ok(Math.abs(b.z - -15) > Math.abs(a.z - -15) * 1.5);
  const stop = step(a, { x: 0, z: 0, run: false }, 1, [], L.LIMIT);
  assert.equal(stop, 0);
});

test("ninguém atravessa a parede de uma casa", () => {
  const lot = L.LOTS[0];
  const b = { x: lot.position.x, z: lot.position.z - 6.6, vx: 0, vz: 0, facing: 0 };
  for (let i = 0; i < 200; i++) step(b, { x: 0, z: 1, run: true }, 0.05, L.OBSTACLES, L.LIMIT);
  assert.ok(b.z < lot.position.z + 0.8 - 2.4, `entrou na casa: z=${b.z}`);
});
