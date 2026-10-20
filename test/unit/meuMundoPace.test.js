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
