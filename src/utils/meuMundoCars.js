// src/utils/meuMundoCars.js
//
// MEU MUNDO 3D — carros. Um carro por casa com titular, estacionado na rua
// junto ao meio-fio, em frente ao lote. Só o titular dirige o dele.
//
// mm3d-12: o carro deixou de ser "um boneco mais rápido" (mm3d-11 usava a
// regra de deslocamento a pé com outro perfil). A física agora é a de
// meuMundoVehicle.js — rodas, inércia, aderência, freio de mão — e este
// arquivo guarda só o que é do BAIRRO: vaga, caixa, onde descer, regras de
// sair/recuperar. O cliente espelha as constantes em engine/motion.ts (CAR).
//
// Estado do carro (posição, quem dirige) vive SÓ na sala — não vai ao banco.
// Sala que reabre põe cada carro de volta na vaga da casa.

const { LOTS, LOT_PLAN, lotToWorld } = require("./meuMundoLayout");
const { VEHICLE } = require("./meuMundoVehicle");
const { resolveCircle } = require("./meuMundoMotion");

const CAR = Object.freeze({
  HX: VEHICLE.HX, // meia-largura da caixa que bloqueia quem está a pé
  HZ: VEHICLE.HZ, // meio-comprimento
  ENTER_RADIUS: 3.4, // distância do centro do carro para "Entrar no carro"
  EXIT_MAX_SPEED: 1.5, // m/s — só desce com o carro (quase) parado
  RECOVER_MAX_SPEED: 2, // m/s — recuperar só parado ou quase
  RECOVER_COOLDOWN_MS: 15000,
});

// Vaga: na rua, faixa junto ao meio-fio do lote (a calçada vai de -12 a -14
// na coordenada local do lote; o carro fica com o centro a 1,3 m do meio-fio),
// à esquerda do caminho da porta, paralelo à rua.
const PARK_LOCAL = Object.freeze({ x: -6, z: LOT_PLAN.access.z - 2 - 1.3 });

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** Onde o carro da casa estaciona e para onde aponta (ao longo da rua). */
function parkingSpot(lotNumber) {
  const lot = LOTS[lotNumber - 1];
  const p = lotToWorld(lot, PARK_LOCAL.x, PARK_LOCAL.z);
  // +X local do lote, girado com ele (mesma convenção de rotY do layout).
  const c = Math.cos(lot.rotationY);
  const s = Math.sin(lot.rotationY);
  const along = { x: c, z: -s };
  return { x: round(p.x), z: round(p.z), facing: round(Math.atan2(along.x, along.z)) };
}

/** Caixa de colisão do carro (mesmo formato dos obstáculos do bairro). */
function carBox(car) {
  return { x: car.x, z: car.z, hx: CAR.HX, hz: CAR.HZ, rot: car.facing, h: 1.3 };
}

/**
 * O carro cabe aqui sem encostar em nada? Confere os três círculos de
 * colisão da física (frente, meio, traseira) — é a mesma forma que bate.
 */
function carFits(x, z, facing, boxes) {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  for (const off of [VEHICLE.COL_OFFSET, 0, -VEHICLE.COL_OFFSET]) {
    const cx = x + fx * off;
    const cz = z + fz * off;
    const p = resolveCircle(cx, cz, VEHICLE.COL_RADIUS, boxes, 1);
    if (Math.hypot(p.x - cx, p.z - cz) > 1e-4) return false;
  }
  return true;
}

/**
 * Pontos para descer do carro, em ordem de preferência: lado do motorista,
 * lado do passageiro, atrás, na frente. Quem chama confere se o ponto é livre.
 */
function exitSpots(car, walkerRadius) {
  const f = { x: Math.sin(car.facing), z: Math.cos(car.facing) };
  const r = { x: f.z, z: -f.x }; // direita = cima × frente (mão esquerda)
  const side = CAR.HX + walkerRadius + 0.25;
  const end = CAR.HZ + walkerRadius + 0.25;
  return [
    { x: car.x - r.x * side, z: car.z - r.z * side },
    { x: car.x + r.x * side, z: car.z + r.z * side },
    { x: car.x - f.x * end, z: car.z - f.z * end },
    { x: car.x + f.x * end, z: car.z + f.z * end },
  ].map((p) => ({ x: round(p.x), z: round(p.z), facing: car.facing }));
}

module.exports = { CAR, parkingSpot, carBox, carFits, exitSpots };
