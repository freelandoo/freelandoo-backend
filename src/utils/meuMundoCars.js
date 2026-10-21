// src/utils/meuMundoCars.js
//
// MEU MUNDO 3D — veículos do bairro. Desde o mm3d-14 cada casa com titular
// tem QUATRO: o carro (na rua, junto ao meio-fio) e, espalhados na calçada
// em frente ao lote, uma bicicleta, um skate e um par de patins.
//
// mm3d-12: o carro deixou de ser "um boneco mais rápido" (mm3d-11 usava a
// regra de deslocamento a pé com outro perfil). A física é a de
// meuMundoVehicle.js — rodas, inércia, aderência, freio de mão — e vale para
// as quatro modalidades (a mobilidade é a mesma; muda a forma que bate).
// Este arquivo guarda só o que é do BAIRRO: vaga, caixa, onde descer, quem
// pode usar. O cliente espelha as constantes em engine/motion.ts (CAR e
// RIDE_KINDS).
//
// Id do veículo = lote + deslocamento da modalidade (carro 1–20, bike 21–40,
// skate 41–60, patins 61–80); é o que vai em `player.car`.
//
// Estado (posição, quem usa) vive SÓ na sala — não vai ao banco. Sala que
// reabre põe cada veículo de volta na vaga da casa.

const { LOTS, LOT_PLAN, lotToWorld } = require("./meuMundoLayout");
const { VEHICLE, KINDS } = require("./meuMundoVehicle");
const { resolveCircle } = require("./meuMundoMotion");

const CAR = Object.freeze({
  HX: VEHICLE.HX, // meia-largura da caixa que bloqueia quem está a pé
  HZ: VEHICLE.HZ, // meio-comprimento
  ENTER_RADIUS: 3.4, // distância do centro do carro para "Usar"
  EXIT_MAX_SPEED: 1.5, // m/s — só desce com o veículo (quase) parado
  RECOVER_MAX_SPEED: 2, // m/s — recuperar só parado ou quase
  RECOVER_COOLDOWN_MS: 15000,
});

/**
 * Modalidades: deslocamento do id, raio para "Usar", só o titular?, a caixa
 * bloqueia quem anda quando ESTACIONADO?, e o estado `move` de quem usa
 * (6 bike, 7 skate, 8 patins — o carro esconde a pessoa: 0).
 */
const RIDE_KINDS = Object.freeze({
  car: Object.freeze({ offset: 0, enter: CAR.ENTER_RADIUS, ownerOnly: true, parkedBlocks: true, move: 0 }),
  bike: Object.freeze({ offset: 20, enter: 1.8, ownerOnly: false, parkedBlocks: true, move: 6 }),
  skate: Object.freeze({ offset: 40, enter: 1.5, ownerOnly: false, parkedBlocks: false, move: 7 }),
  skates: Object.freeze({ offset: 60, enter: 1.5, ownerOnly: false, parkedBlocks: false, move: 8 }),
});
const KIND_NAMES = Object.freeze(Object.keys(RIDE_KINDS));

// Vaga do carro: na rua, faixa junto ao meio-fio do lote (a calçada vai de
// -12 a -14 na coordenada local do lote; o carro fica com o centro a 1,3 m do
// meio-fio), à esquerda do caminho da porta, paralelo à rua.
const PARK_LOCAL = Object.freeze({ x: -6, z: LOT_PLAN.access.z - 2 - 1.3 });
// Os pequenos, na CALÇADA em frente ao lote, fora do caminho da porta (x≈0).
const SMALL_LOCAL = Object.freeze({
  bike: Object.freeze({ x: 4.4, z: LOT_PLAN.access.z - 1.0 }),
  skate: Object.freeze({ x: 6.6, z: LOT_PLAN.access.z - 1.1 }),
  skates: Object.freeze({ x: -2.7, z: LOT_PLAN.access.z - 0.8 }),
});

function round(v) {
  return Math.round(v * 1000) / 1000;
}

const vehicleId = (kind, lot) => RIDE_KINDS[kind].offset + lot;
/** Modalidade pelo id (1–80); null fora da faixa. */
function kindOfId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 80) return null;
  return KIND_NAMES[Math.floor((n - 1) / 20)];
}
const lotOfId = (id) => ((Number(id) - 1) % 20) + 1;

/** Direção ao longo da rua, em frente ao lote (+X local girado com ele). */
function alongStreet(lot) {
  const c = Math.cos(lot.rotationY);
  const s = Math.sin(lot.rotationY);
  return Math.atan2(c, -s);
}

/** Onde o carro da casa estaciona e para onde aponta (ao longo da rua). */
function parkingSpot(lotNumber) {
  const lot = LOTS[lotNumber - 1];
  const p = lotToWorld(lot, PARK_LOCAL.x, PARK_LOCAL.z);
  return { x: round(p.x), z: round(p.z), facing: round(alongStreet(lot)) };
}

/**
 * Vaga de uma modalidade. Os pequenos ficam "espalhados": posição e ângulo
 * variam um pouco de lote para lote (determinístico — a sala que reabre põe
 * tudo no mesmo lugar).
 */
function spotFor(kind, lotNumber) {
  if (kind === "car") return parkingSpot(lotNumber);
  const lot = LOTS[lotNumber - 1];
  const base = SMALL_LOCAL[kind];
  const jx = (((lotNumber * 13) % 5) - 2) * 0.18;
  const p = lotToWorld(lot, base.x + jx, base.z);
  const along = alongStreet(lot);
  const turn =
    kind === "bike" ? (lotNumber % 2 ? 0 : Math.PI) : (((lotNumber * 7) % 5) - 2) * 0.32 + (kind === "skates" ? Math.PI / 2 : 0);
  let f = along + turn;
  while (f > Math.PI) f -= 2 * Math.PI;
  while (f < -Math.PI) f += 2 * Math.PI;
  return { x: round(p.x), z: round(p.z), facing: round(f) };
}

/** Meia-largura/meio-comprimento da caixa de uma modalidade. */
function dims(kind) {
  const k = KINDS[kind] || {};
  return { hx: k.HX ?? VEHICLE.HX, hz: k.HZ ?? VEHICLE.HZ };
}

/** Caixa de colisão do veículo (mesmo formato dos obstáculos do bairro). */
function carBox(car) {
  const d = dims(car.kind || "car");
  return { x: car.x, z: car.z, hx: d.hx, hz: d.hz, rot: car.facing, h: car.kind === "car" || !car.kind ? 1.3 : 1.0 };
}

/** O veículo bloqueia quem não o usa? (skate e patins estacionados, não). */
function blocks(car) {
  const k = RIDE_KINDS[car.kind || "car"];
  return !!car.driver || !k || k.parkedBlocks;
}

/**
 * O veículo cabe aqui sem encostar em nada? Confere os três círculos de
 * colisão da física (frente, meio, traseira) — é a mesma forma que bate.
 */
function carFits(x, z, facing, boxes, kind = "car") {
  const P = { ...VEHICLE, ...(KINDS[kind] || {}) };
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  for (const off of [P.COL_OFFSET, 0, -P.COL_OFFSET]) {
    const cx = x + fx * off;
    const cz = z + fz * off;
    const p = resolveCircle(cx, cz, P.COL_RADIUS, boxes, 1);
    if (Math.hypot(p.x - cx, p.z - cz) > 1e-4) return false;
  }
  return true;
}

/**
 * Pontos para descer, em ordem de preferência: lado esquerdo, lado direito,
 * atrás, na frente. Quem chama confere se o ponto é livre.
 */
function exitSpots(car, walkerRadius) {
  const d = dims(car.kind || "car");
  const f = { x: Math.sin(car.facing), z: Math.cos(car.facing) };
  const r = { x: f.z, z: -f.x }; // direita = cima × frente (mão esquerda)
  const side = d.hx + walkerRadius + 0.25;
  const end = d.hz + walkerRadius + 0.25;
  return [
    { x: car.x - r.x * side, z: car.z - r.z * side },
    { x: car.x + r.x * side, z: car.z + r.z * side },
    { x: car.x - f.x * end, z: car.z - f.z * end },
    { x: car.x + f.x * end, z: car.z + f.z * end },
  ].map((p) => ({ x: round(p.x), z: round(p.z), facing: car.facing }));
}

module.exports = {
  CAR,
  RIDE_KINDS,
  KIND_NAMES,
  vehicleId,
  kindOfId,
  lotOfId,
  parkingSpot,
  spotFor,
  carBox,
  blocks,
  carFits,
  exitSpots,
};
