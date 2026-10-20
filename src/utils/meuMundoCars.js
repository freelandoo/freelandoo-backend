// src/utils/meuMundoCars.js
//
// MEU MUNDO 3D — carros (mm3d-11). Um carro por casa com titular, estacionado
// na rua junto ao meio-fio, em frente ao lote. Só o titular dirige o dele.
//
// O carro é um CORPO a mais na mesma regra de deslocamento
// (meuMundoMotion.step) com outro perfil: mais rápido, aceleração mais lenta e
// círculo de colisão maior. O cliente roda a MESMA conta na predição
// (features/meu-mundo/engine/motion.ts, CAR): mexeu num lado, mexe no outro.
//
// Estado do carro (posição, quem dirige) vive SÓ na sala — não vai ao banco.
// Sala que reabre põe cada carro de volta na vaga da casa.

const { LOTS, LOT_PLAN, lotToWorld } = require("./meuMundoLayout");

const CAR = Object.freeze({
  SPEED: 9, // m/s dirigindo normal (a corrida a pé é 3,5)
  TURBO: 13, // m/s com "correr" ligado
  ACCEL: 2.4, // 1/s — o carro ganha e perde velocidade devagar
  RADIUS: 1.4, // círculo de colisão (o modelo tem 4,0 × 2,4 m)
  HX: 1.15, // meia-largura da caixa que bloqueia quem está a pé
  HZ: 1.95, // meio-comprimento
  ENTER_RADIUS: 3.4, // distância do centro do carro para "Entrar no carro"
});

/** Perfil do carro para meuMundoMotion.step. */
const CAR_PROFILE = Object.freeze({ walk: CAR.SPEED, run: CAR.TURBO, accel: CAR.ACCEL, radius: CAR.RADIUS });

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
  return { x: car.x, z: car.z, hx: CAR.HX, hz: CAR.HZ, rot: car.facing, h: 1.4 };
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

module.exports = { CAR, CAR_PROFILE, parkingSpot, carBox, exitSpots };
