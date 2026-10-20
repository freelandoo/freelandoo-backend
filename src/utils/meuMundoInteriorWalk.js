// src/utils/meuMundoInteriorWalk.js
//
// MEU MUNDO 3D — percorre um interior com a regra de movimento REAL
// (stepInterior) a partir da entrada, numa grade de 25 cm, e devolve tudo
// que o personagem consegue alcançar: células por andar, cômodos visitados,
// subida e descida de cada escada, assentos e saída. É o "percorra todos os
// cômodos e suba todas as escadas" automatizado — usado pelo teste unitário
// e pela conferência das plantas.

const { MOTION } = require("./meuMundoMotion");
const { stepInterior } = require("./meuMundoInteriorMotion");

const CELL = 0.25;

function walkInterior(def, { cell = CELL } = {}) {
  const key = (f, x, z) => `${f}|${Math.round(x / cell)}|${Math.round(z / cell)}`;
  const seen = new Map();
  const queue = [];
  const push = (b) => {
    const k = key(b.floor, b.x, b.z);
    if (seen.has(k)) return;
    seen.set(k, { floor: b.floor, x: b.x, z: b.z, y: b.y });
    queue.push({ floor: b.floor, x: b.x, z: b.z });
  };
  push({ floor: def.entry.floor, x: def.entry.x, z: def.entry.z, y: def.floors[0].y });
  const dirs = [];
  for (let i = 0; i < 8; i++) dirs.push([Math.sin((i * Math.PI) / 4), Math.cos((i * Math.PI) / 4)]);
  const transitions = new Set();
  while (queue.length) {
    const s = queue.shift();
    for (const [dx, dz] of dirs) {
      const b = { x: s.x, z: s.z, vx: dx * MOTION.WALK_SPEED, vz: dz * MOTION.WALK_SPEED, facing: 0, floor: s.floor, y: 0 };
      // Anda uma célula (e um pouco mais) na direção, com a regra real.
      const t = (cell * 1.05) / MOTION.WALK_SPEED;
      stepInterior(b, { x: dx, z: dz, run: false }, t, def);
      if (Math.hypot(b.x - s.x, b.z - s.z) < cell * 0.4 && b.floor === s.floor) continue;
      if (b.floor !== s.floor) transitions.add(`${s.floor}>${b.floor}`);
      // Fixa na grade (o próprio passo já é colisão-correto).
      const gx = Math.round(b.x / cell) * cell;
      const gz = Math.round(b.z / cell) * cell;
      const snapped = { x: gx, z: gz, vx: 0, vz: 0, facing: 0, floor: b.floor, y: 0 };
      stepInterior(snapped, { x: 0, z: 0, run: false }, 0.001, def);
      push(snapped);
    }
  }
  const cells = [...seen.values()];
  const near = (floor, x, z, r) => cells.some((c) => c.floor === floor && Math.hypot(c.x - x, c.z - z) <= r);
  const rooms = def.floors.map((fl, fi) =>
    fl.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      reached: cells.some((c) => c.floor === fi && c.x > r.x0 + 0.2 && c.x < r.x1 - 0.2 && c.z > r.z0 + 0.2 && c.z < r.z1 - 0.2),
    }))
  );
  const seats = def.seats.map((s) => ({ id: s.id, reached: near(s.floor, s.stand.x, s.stand.z, cell * 1.2) }));
  return {
    cells,
    rooms,
    seats,
    exit: near(def.exit.floor, def.exit.x, def.exit.z, def.exit.radius),
    transitions: [...transitions].sort(),
    floorsReached: [...new Set(cells.map((c) => c.floor))].sort(),
  };
}

module.exports = { walkInterior };
