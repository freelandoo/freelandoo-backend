// Interiores das casas do Meu Mundo (mm3d-09): cada nível é percorrido com a
// regra de movimento REAL a partir da porta — todos os cômodos, todas as
// escadas (subir e descer), todos os assentos e a saída.
const test = require("node:test");
const assert = require("node:assert");
const { interiorFor, interiorSummary } = require("../../src/utils/meuMundoInteriors");
const { walkInterior } = require("../../src/utils/meuMundoInteriorWalk");
const { stepInterior, isFreeSpot } = require("../../src/utils/meuMundoInteriorMotion");
const { HOUSE_CATALOG } = require("../../src/utils/meuMundoLayout");

const AVAILABLE = HOUSE_CATALOG.filter((l) => l.available).map((l) => l.level);

test("todo nível instalado tem interior próprio (e só eles)", () => {
  assert.deepStrictEqual(AVAILABLE, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const l of AVAILABLE) assert.ok(interiorFor(l), `nível ${l} sem interior`);
  assert.strictEqual(interiorFor(10), null);
  const sig = new Set(AVAILABLE.map((l) => JSON.stringify(interiorFor(l).floors.map((f) => f.rooms))));
  assert.strictEqual(sig.size, AVAILABLE.length, "dois níveis com a mesma planta");
});

test("pisos coerentes com a casa vista por fora", () => {
  const floors = Object.fromEntries(interiorSummary().map((s) => [s.level, s.floors]));
  assert.deepStrictEqual(floors, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3 });
});

test("casa maior tem mais cômodos", () => {
  const s = interiorSummary();
  const rooms = (l) => s.find((x) => x.level === l).rooms.flat().length;
  assert.ok(rooms(1) < rooms(3) && rooms(3) < rooms(5 + 1) && rooms(4) < rooms(7));
});

for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  test(`nível ${level}: percurso completo pela regra de movimento`, () => {
    const d = interiorFor(level);
    const w = walkInterior(d);
    for (const [fi, f] of w.rooms.entries()) {
      for (const r of f) if (r.name !== "Escada") assert.ok(r.reached, `cômodo ${r.id} (piso ${fi}) inalcançável`);
    }
    for (const s of w.seats) assert.ok(s.reached, `assento ${s.id} sem acesso`);
    assert.ok(w.exit, "saída inalcançável");
    assert.ok(d.seats.length >= 2, "precisa de pelo menos dois assentos");
    assert.deepStrictEqual(w.floorsReached, d.floors.map((_, i) => i));
    for (const st of d.stairs) {
      assert.ok(w.transitions.includes(`${st.from}>${st.to}`), "não sobe a escada");
      assert.ok(w.transitions.includes(`${st.to}>${st.from}`), "não desce a escada");
    }
    // Nada fora da casa: toda célula alcançada está dentro de algum cômodo do andar.
    for (const c of w.cells) {
      const inside = d.floors[c.floor].rooms.some((r) => c.x >= r.x0 - 0.05 && c.x <= r.x1 + 0.05 && c.z >= r.z0 - 0.05 && c.z <= r.z1 + 0.05);
      assert.ok(inside, `célula fora da casa: piso ${c.floor} ${c.x},${c.z}`);
    }
  });
}

test("escada: subir não teletransporta (altura contínua)", () => {
  const d = interiorFor(5);
  const st = d.stairs[0];
  const b = { x: (st.x0 + st.x1) / 2, z: st.z0 - 0.8, vx: 0, vz: 0, facing: 0, floor: 0, y: 0 };
  let prev = 0;
  let maxJump = 0;
  for (let i = 0; i < 200; i++) {
    stepInterior(b, { x: 0, z: 1, run: false }, 0.05, d);
    maxJump = Math.max(maxJump, Math.abs(b.y - prev));
    prev = b.y;
  }
  assert.strictEqual(b.floor, 1);
  assert.ok(Math.abs(b.y - d.floors[1].y) < 1e-6);
  assert.ok(maxJump < 0.25, `degrau de ${maxJump}`);
});

test("andar de cima: não se cai pelo vão nem se atravessa a laje", () => {
  const d = interiorFor(7);
  const st = d.stairs[0];
  // No andar de cima, andando pela lateral do vão, nunca muda de andar.
  const b = { x: st.x1 + 0.6, z: st.z1 - 0.5, vx: 0, vz: 0, facing: 0, floor: 1, y: d.floors[1].y };
  for (let i = 0; i < 80; i++) stepInterior(b, { x: -1, z: -0.2, run: true }, 0.05, d);
  assert.strictEqual(b.floor, 1);
  assert.ok(Math.abs(b.y - d.floors[1].y) < 1e-6);
  // No térreo, por baixo do patamar, não se sobe pela lateral.
  assert.ok(!isFreeSpot(d, 0, st.x0 - 0.06, (st.z0 + st.z1) / 2));
});

test("assentos: ids únicos e ponto de levantar livre", () => {
  for (const l of AVAILABLE) {
    const d = interiorFor(l);
    assert.strictEqual(new Set(d.seats.map((s) => s.id)).size, d.seats.length);
    for (const s of d.seats) assert.ok(isFreeSpot(d, s.floor, s.stand.x, s.stand.z));
  }
});

test("camas (mm3d-13): toda casa tem onde dormir; casal = 2 lugares; levantar livre e perto", () => {
  const { FURNITURE, BED_REACH } = require("../../src/utils/meuMundoInteriorKit");
  for (const l of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const d = interiorFor(l);
    assert.ok(d.beds.length >= 1, `nível ${l} sem cama`);
    assert.strictEqual(new Set(d.beds.map((b) => b.id)).size, d.beds.length);
    const furniture = d.floors.flatMap((f) => f.furniture).filter((it) => FURNITURE[it.t].beds);
    const expected = furniture.reduce((n, it) => n + FURNITURE[it.t].beds.length, 0);
    assert.strictEqual(d.beds.length, expected, `nível ${l}: ${d.beds.length} de ${expected} lugares`);
    for (const b of d.beds) {
      assert.ok(isFreeSpot(d, b.floor, b.stand.x, b.stand.z), `nível ${l} ${b.id}: levantar bloqueado`);
      assert.ok(Math.hypot(b.stand.x - b.x, b.stand.z - b.z) <= BED_REACH, `nível ${l} ${b.id}: levantar longe`);
    }
  }
});
