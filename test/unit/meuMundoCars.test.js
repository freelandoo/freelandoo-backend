// Carros do Meu Mundo (mm3d-11): vagas livres nos 20 lotes, lugar para descer,
// e as constantes do bairro iguais no servidor e no cliente
// (features/meu-mundo/engine/motion.ts, CAR). A física está em meuMundoVehicle.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../../src/utils/meuMundoLayout");
const M = require("../../src/utils/meuMundoMotion");
const C = require("../../src/utils/meuMundoCars");

test("cada lote tem vaga livre na rua (para o carro inteiro) e lugar para descer", () => {
  const obs = L.buildObstacles();
  for (let n = 1; n <= 20; n++) {
    const p = C.parkingSpot(n);
    assert.ok(C.carFits(p.x, p.z, p.facing, obs), `vaga do lote ${n}`);
    const free = C.exitSpots(p, M.MOTION.RADIUS).filter((e) =>
      L.isSafeSpot(e.x, e.z, M.resolveCircle, M.MOTION.RADIUS, obs.concat([C.carBox(p)]))
    );
    assert.ok(free.length > 0, `descer no lote ${n}`);
  }
});

test("carFits recusa vaga ocupada por outro carro", () => {
  const p = C.parkingSpot(1);
  assert.equal(C.carFits(p.x, p.z, p.facing, [C.carBox(p)]), false);
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
