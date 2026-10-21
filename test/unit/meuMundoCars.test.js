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

// ═══ mm3d-14: bicicleta, skate e patins ═══
test("ids: lote + deslocamento, ida e volta nas quatro modalidades", () => {
  for (const kind of C.KIND_NAMES) {
    for (const lot of [1, 7, 20]) {
      const id = C.vehicleId(kind, lot);
      assert.equal(C.kindOfId(id), kind, `${kind} ${lot}`);
      assert.equal(C.lotOfId(id), lot);
    }
  }
  assert.equal(C.kindOfId(0), null);
  assert.equal(C.kindOfId(81), null);
  assert.equal(C.kindOfId("x"), null);
});

test("cada lote tem bike, skate e patins em lugar livre da calçada, sem encostar no carro nem entre si", () => {
  const obs = L.buildObstacles();
  for (let n = 1; n <= 20; n++) {
    const car = { kind: "car", ...C.parkingSpot(n) };
    const placed = [C.carBox(car)];
    for (const kind of ["bike", "skate", "skates"]) {
      const p = C.spotFor(kind, n);
      assert.ok(C.carFits(p.x, p.z, p.facing, obs.concat(placed), kind), `${kind} do lote ${n}`);
      const free = C.exitSpots({ kind, ...p }, M.MOTION.RADIUS).filter((e) =>
        L.isSafeSpot(e.x, e.z, M.resolveCircle, M.MOTION.RADIUS, obs.concat(placed, [C.carBox({ kind, ...p })]))
      );
      assert.ok(free.length > 0, `descer do ${kind} no lote ${n}`);
      placed.push(C.carBox({ kind, ...p }));
    }
  }
});

test("a pessoa ainda chega à porta: o caminho do lote fica livre dos veículos", () => {
  const obs = L.buildObstacles();
  for (let n = 1; n <= 20; n++) {
    const boxes = ["bike", "skate", "skates"].map((kind) => C.carBox({ kind, ...C.spotFor(kind, n) }));
    const f = L.frontOfHouse(n);
    assert.ok(L.isSafeSpot(f.x, f.z, M.resolveCircle, M.MOTION.RADIUS, obs.concat(boxes)), `frente da casa ${n}`);
  }
});

test("skate e patins estacionados não bloqueiam; bike e carro sim; em uso, todos", () => {
  assert.equal(C.blocks({ kind: "skate", driver: "" }), false);
  assert.equal(C.blocks({ kind: "skates", driver: "" }), false);
  assert.equal(C.blocks({ kind: "bike", driver: "" }), true);
  assert.equal(C.blocks({ kind: "car", driver: "" }), true);
  assert.equal(C.blocks({ kind: "skate", driver: "abc" }), true);
});

test("modalidades iguais no cliente (motion.ts RIDE_KINDS)", (t) => {
  const f = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/engine/motion.ts");
  if (!fs.existsSync(f)) return t.skip("frontend não está ao lado");
  const src = fs.readFileSync(f, "utf8");
  const start = src.indexOf("export const RIDE_KINDS");
  assert.ok(start > 0, "RIDE_KINDS ausente no cliente");
  const block = src.slice(start, src.indexOf("} as const", start));
  for (const [kind, k] of Object.entries(C.RIDE_KINDS)) {
    const line = block.split("\n").find((l) => l.trim().startsWith(`${kind}:`));
    assert.ok(line, `${kind} ausente`);
    for (const key of ["offset", "enter", "move"]) assert.ok(new RegExp(`${key}:\\s*${k[key]}\\b`).test(line), `${kind}.${key}`);
    assert.ok(line.includes(`ownerOnly: ${k.ownerOnly}`) && line.includes(`parkedBlocks: ${k.parkedBlocks}`), `${kind} flags`);
  }
});
