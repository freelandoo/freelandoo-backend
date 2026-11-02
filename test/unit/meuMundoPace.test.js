// Ritmo de caminhada pelo corpo (mm3d-13): cansado anda mais devagar,
// exausto não corre — no servidor (meuMundoMotion/InteriorMotion) e no espelho
// do cliente (features/meu-mundo/engine/motion.ts e interior-motion.ts).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { MOTION, paceSpeeds, step } = require("../../src/utils/meuMundoMotion");
const { stepInterior } = require("../../src/utils/meuMundoInteriorMotion");
const { interiorFor } = require("../../src/utils/meuMundoInteriors");
const { PACE } = require("../../src/utils/meuMundoLife");

function walkFor(seconds, speeds, run) {
  const b = { x: 0, z: 0, vx: 0, vz: 0, facing: 0 };
  let move = 0;
  for (let i = 0; i < seconds * 20; i++) {
    move = step(b, { x: 0, z: 1, run }, 0.05, [], 1e4, { walk: speeds.walk, run: speeds.run, accel: MOTION.ACCEL, radius: MOTION.RADIUS });
  }
  return { dist: b.z, move };
}

test("normal = velocidades de sempre; cansado mais lento; exausto não corre", () => {
  assert.deepEqual(paceSpeeds(PACE.NORMAL), { walk: MOTION.WALK_SPEED, run: MOTION.RUN_SPEED });
  const tired = paceSpeeds(PACE.TIRED);
  assert.ok(tired.walk < MOTION.WALK_SPEED && tired.run > tired.walk);
  const ex = paceSpeeds(PACE.EXHAUSTED);
  assert.equal(ex.run, ex.walk);
  assert.deepEqual(paceSpeeds(NaN), paceSpeeds(1));
  assert.deepEqual(paceSpeeds(5), paceSpeeds(1));
});

test("exausto segurando correr: anda (estado 1), na velocidade de andar", () => {
  const ex = walkFor(4, paceSpeeds(PACE.EXHAUSTED), true);
  assert.equal(ex.move, 1);
  const n = walkFor(4, paceSpeeds(1), true);
  assert.equal(n.move, 2);
  assert.ok(ex.dist < n.dist * 0.3, `${ex.dist} × ${n.dist}`);
});

test("dentro de casa vale a mesma regra", () => {
  const def = interiorFor(4);
  const b = { ...def.entry, vx: 0, vz: 0, y: 0 };
  let move = 0;
  for (let i = 0; i < 20; i++) move = stepInterior(b, { x: 0, z: 1, run: true }, 0.05, def, paceSpeeds(PACE.EXHAUSTED));
  assert.equal(move, 1);
});

test("espelho do cliente: paceSpeeds e a regra de correr", (t) => {
  const dir = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/engine");
  if (!fs.existsSync(dir)) return t.skip("frontend não está ao lado");
  const motion = fs.readFileSync(path.join(dir, "motion.ts"), "utf8");
  const inner = fs.readFileSync(path.join(dir, "interior-motion.ts"), "utf8");
  assert.match(motion, new RegExp(`PACE_RUN_MIN: ${MOTION.PACE_RUN_MIN},`));
  assert.match(motion, /export function paceSpeeds\(/);
  assert.match(motion, /intent\.run && speeds\.run > speeds\.walk && speed >/);
  assert.match(inner, /intent\.run && speeds\.run > speeds\.walk && speed >/);
});

// 2026-11-02 (pedido do Alex): corpo maior percorre mais chão no mesmo tempo.
const { HEIGHT, bodyStride } = require("../../src/utils/meuMundoHeights");

test("passada pelo tamanho: adulto 2,7 m anda 1,5×; menor que 1,8 m não fica lento", () => {
  assert.equal(bodyStride("normal"), 1);
  assert.equal(bodyStride("raposa"), 1);
  assert.equal(bodyStride("vampiro_adulto"), 1.5);
  assert.ok(Math.abs(bodyStride("golem") - 4 / 1.8) < 1e-9);
  const big = paceSpeeds(1, bodyStride("raposa_adulta"));
  assert.ok(Math.abs(big.walk - MOTION.WALK_SPEED * 1.5) < 1e-9);
  assert.ok(Math.abs(big.run - MOTION.RUN_SPEED * 1.5) < 1e-9);
  assert.ok(walkFor(4, big, true).dist > walkFor(4, paceSpeeds(1), true).dist * 1.45);
  // cansado + grande: as duas contas valem juntas; exausto segue sem correr
  const ex = paceSpeeds(PACE.EXHAUSTED, 1.5);
  assert.equal(ex.run, ex.walk);
  assert.deepEqual(paceSpeeds(1, NaN), paceSpeeds(1));
});

test("espelho do cliente: tabela de alturas e a passada", (t) => {
  const dir = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo");
  if (!fs.existsSync(dir)) return t.skip("frontend não está ao lado");
  const heights = fs.readFileSync(path.join(dir, "heights.ts"), "utf8");
  for (const [body, h] of Object.entries(HEIGHT)) {
    assert.match(heights, new RegExp(`\\s${body}: ${String(h).replace(".", "\\.")}(\\.0)?,`), body);
  }
  assert.match(heights, /export const bodyStride = \(b: BodyId\): number => Math\.max\(1, bodyHeight\(b\) \/ BASE_HEIGHT\)/);
  const motion = fs.readFileSync(path.join(dir, "engine/motion.ts"), "utf8");
  assert.match(motion, /export function paceSpeeds\(pace = 1, base = \{ walk: MOTION\.WALK_SPEED, run: MOTION\.RUN_SPEED \}, stride = 1\)/);
});
