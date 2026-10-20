// Carros do Meu Mundo (mm3d-11): vagas livres nos 20 lotes, lugar para descer,
// e as constantes do carro iguais no servidor e no cliente (a predição local
// roda a mesma regra — features/meu-mundo/engine/motion.ts, CAR).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../../src/utils/meuMundoLayout");
const M = require("../../src/utils/meuMundoMotion");
const C = require("../../src/utils/meuMundoCars");

test("cada lote tem vaga livre na rua e lugar para descer do carro", () => {
  const obs = L.buildObstacles();
  for (let n = 1; n <= 20; n++) {
    const p = C.parkingSpot(n);
    assert.ok(L.isSafeSpot(p.x, p.z, M.resolveCircle, C.CAR.RADIUS, obs), `vaga do lote ${n}`);
    const free = C.exitSpots(p, M.MOTION.RADIUS).filter((e) =>
      L.isSafeSpot(e.x, e.z, M.resolveCircle, M.MOTION.RADIUS, obs.concat([C.carBox(p)]))
    );
    assert.ok(free.length > 0, `descer no lote ${n}`);
  }
});

test("dirigindo é bem mais rápido que correndo a pé", () => {
  const b = { x: 0, z: 0, vx: 0, vz: 0, facing: 0 };
  for (let i = 0; i < 100; i++) M.step(b, { x: 0, z: 1, run: true }, 0.05, [], 1000, C.CAR_PROFILE);
  const car = Math.hypot(b.vx, b.vz);
  assert.ok(car > M.MOTION.RUN_SPEED * 3, `carro ${car}`);
  assert.ok(car <= C.CAR.TURBO + 1e-6);
});

test("constantes do carro iguais no cliente", (t) => {
  const f = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/engine/motion.ts");
  if (!fs.existsSync(f)) return t.skip("frontend não está ao lado");
  const src = fs.readFileSync(f, "utf8");
  const block = src.slice(src.indexOf("export const CAR = {"), src.indexOf("}", src.indexOf("export const CAR = {")));
  for (const [k, v] of Object.entries(C.CAR)) {
    const m = block.match(new RegExp(`${k}:\\s*([0-9.]+)`));
    assert.ok(m, `CAR.${k} ausente no cliente`);
    assert.equal(Number(m[1]), v, `CAR.${k}`);
  }
});
