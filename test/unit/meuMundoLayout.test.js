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
  const home = L.frontOfHouse(1);
  const b = { x: home.x, z: home.z, vx: 0, vz: 0, facing: 0 };
  for (let i = 0; i < 400; i++) step(b, { x: 0, z: 1, run: true }, 0.05, L.OBSTACLES, L.LIMIT);
  assert.ok(b.z < lot.position.z + L.LOT_PLAN.houseFront.z, `entrou na casa: z=${b.z}`);
});

// ── mm3d-03: terrenos maiores ────────────────────────────────────────────────

// O lote do mm3d-02 (9 × 12, casa com a fachada a 1,6 m do centro) medido com
// a MESMA conta do atual.
const OLD_PLAN = {
  width: 9,
  depth: 12,
  setbacks: { front: 0, side: 0, back: 0 },
  houseFront: { x: 0, z: -1.6 },
  access: { x: 0, z: -6 },
  hedge: { thickness: 0.3, height: 0.7, frontGap: 3.1 },
};

test("jardim livre de cada lote é pelo menos 4× o do mm3d-02", () => {
  const before = L.lotMetrics(OLD_PLAN);
  const after = L.lotMetrics();
  assert.equal(before.garden, 68.365);
  assert.ok(after.garden >= 4 * before.garden, `${after.garden} < 4 × ${before.garden}`);
});

test("o espaço novo foi para frente, laterais E fundos", () => {
  const b = L.lotMetrics(OLD_PLAN).yards;
  const a = L.lotMetrics().yards;
  assert.ok(a.front > b.front && a.side > b.side && a.back > b.back, JSON.stringify({ b, a }));
  // Fundos ganham mais (é para onde as casas maiores crescem), mas a frente
  // não fica com tudo nem com nada.
  assert.ok(a.back >= a.front && a.side >= 2 * b.side);
});

test("casa nível 01 tem o mesmo tamanho de sempre e fica centrada", () => {
  assert.deepEqual([L.HOUSE_L1.width, L.HOUSE_L1.depth, L.HOUSE_L1.height], [5.4, 4.8, 4.6]);
  assert.equal(L.LOT_PLAN.houseFront.x, 0);
  const house = L.lotObstacles(0)[0];
  assert.deepEqual(house.slice(2, 5), [2.7, 2.4, 4.6]);
});

test("área edificável fica dentro do lote e contém a casa atual", () => {
  const P = L.LOT_PLAN;
  const a = L.buildableArea();
  assert.ok(a.minX > -P.width / 2 && a.maxX < P.width / 2);
  assert.ok(a.minZ > -P.depth / 2 && a.maxZ < P.depth / 2);
  const hz0 = P.houseFront.z;
  const hz1 = hz0 + L.HOUSE_L1.depth;
  assert.ok(hz0 >= a.minZ && hz1 <= a.maxZ && L.HOUSE_L1.width / 2 <= a.maxX);
  // Espaço útil para crescer: largo e fundo, não uma faixa estreita.
  assert.ok(a.maxX - a.minX >= 2.5 * L.HOUSE_L1.width);
  assert.ok(a.maxZ - a.minZ >= 3.5 * L.HOUSE_L1.depth);
  // A árvore do jardim não fica no miolo da área edificável.
  assert.ok(P.tree.z < a.minZ || Math.abs(P.tree.x) > a.maxX - 2);
});

/** Retângulo de um lote no mundo (os lotes só giram de 90 em 90 graus). */
function lotRect(lot) {
  const turned = Math.abs(Math.sin(lot.rotationY)) > 0.5;
  const hx = (turned ? L.LOT_PLAN.depth : L.LOT_PLAN.width) / 2;
  const hz = (turned ? L.LOT_PLAN.width : L.LOT_PLAN.depth) / 2;
  return { x0: lot.position.x - hx, x1: lot.position.x + hx, z0: lot.position.z - hz, z1: lot.position.z + hz };
}
const overlaps = (a, b, eps = 1e-6) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;

test("lotes não se sobrepõem nem invadem ruas e calçadas", () => {
  const D = L.DIMS;
  const rects = L.LOTS.map(lotRect);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlaps(rects[i], rects[j]), `lotes ${i + 1} e ${j + 1}`);
  // Anel (pista + calçadas dos dois lados) e a rua de saída com calçadas.
  const w = D.roadHalf + D.sidewalk;
  const big = D.ring + w;
  const streets = [
    { x0: -big, x1: big, z0: D.ring - w, z1: D.ring + w },
    { x0: -big, x1: big, z0: -D.ring - w, z1: -D.ring + w },
    { x0: D.ring - w, x1: D.ring + w, z0: -big, z1: big },
    { x0: -D.ring - w, x1: -D.ring + w, z0: -big, z1: big },
    { x0: D.ring, x1: D.gateX, z0: D.exitZ - w, z1: D.exitZ + w },
  ];
  for (const [i, r] of rects.entries())
    for (const st of streets) assert.ok(!overlaps(r, st), `lote ${i + 1} invade rua`);
  // E todos ficam dentro da cerca.
  for (const r of rects) assert.ok(Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) < D.hedge);
});

test("cada lote dá de frente para a calçada da rua (acesso sem obstáculo)", () => {
  for (const lot of L.LOTS) {
    const front = L.frontOfHouse(lot.number);
    const d = Math.max(Math.abs(front.x), Math.abs(front.z));
    // A frente da casa cai na calçada externa do anel.
    assert.ok(d > L.DIMS.ring + L.DIMS.roadHalf && d < L.DIMS.lotFront, `lote ${lot.number}: ${d}`);
    assert.ok(L.isSafeSpot(front.x, front.z, resolveCircle, MOTION.RADIUS));
  }
});

test("caminho da calçada até a porta é livre", () => {
  for (const lot of L.LOTS) {
    const P = L.LOT_PLAN;
    for (let z = P.access.z - 0.6; z < P.houseFront.z - 0.9; z += 0.25) {
      const p = L.lotToWorld(lot, 0, z);
      const r = resolveCircle(p.x, p.z, MOTION.RADIUS, L.OBSTACLES);
      assert.ok(Math.hypot(r.x - p.x, r.z - p.z) < 1e-6, `lote ${lot.number} bloqueado em z=${z}`);
    }
  }
});

test("nenhum colisor ficou no lugar das casas do mm3d-02", () => {
  // Casas antigas: centro do lote a 37 m do meio, base 0,8 m para dentro.
  const oldCenters = [];
  for (const s of [-18, -9, 0, 9, 18]) {
    oldCenters.push([s, 37.8], [37.8, -s], [-s, -37.8], [-37.8, s]);
  }
  for (const [x, z] of oldCenters) {
    const hit = L.OBSTACLES.find((b) => Math.abs(b.x - x) < 2.7 && Math.abs(b.z - z) < 2.4 && b.hx > 2);
    assert.equal(hit, undefined, `obstáculo velho em ${x},${z}`);
  }
});

test("posição fora do bairro ou dentro de obstáculo não é lugar seguro", () => {
  assert.equal(L.isSafeSpot(0, 0, resolveCircle, MOTION.RADIUS), false); // canteiro
  assert.equal(L.isSafeSpot(200, 0, resolveCircle, MOTION.RADIUS), false);
  assert.equal(L.isSafeSpot(NaN, 0, resolveCircle, MOTION.RADIUS), false);
  const lot = L.LOTS[4];
  const inHouse = L.lotToWorld(lot, 0, L.LOT_PLAN.houseFront.z + 2);
  assert.equal(L.isSafeSpot(inHouse.x, inHouse.z, resolveCircle, MOTION.RADIUS), false);
  assert.equal(L.isSafeSpot(0, -15, resolveCircle, MOTION.RADIUS), true); // spawn
});

test("payload leva a configuração do lote e as medidas do bairro", () => {
  const n = nb();
  assert.equal(n.layoutVersion, L.LAYOUT_VERSION);
  assert.equal(n.lots[0].width, 18);
  assert.equal(n.lots[0].depth, 24);
  assert.deepEqual(n.lotPlan.buildable, L.buildableArea());
  assert.equal(n.dims.ring, 50);
  assert.ok(n.limit > n.dims.hedge);
});
