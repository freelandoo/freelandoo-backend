// src/services/MeuMundoService.js — MEU MUNDO 3D (mig 291).
//
// Entrada no bairro: recupera (ou aloca) a residência permanente do usuário,
// monta o bairro DELE e reserva o lugar na sala online desse bairro. Quem
// chama já passou por auth + papel Administrator.

const pool = require("../databases");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const realtime = require("../realtime/meuMundo");
const {
  MEU_MUNDO_RELEASE,
  buildNeighborhoodPayload,
  frontOfHouse,
} = require("../utils/meuMundoLayout");
const { MOTION } = require("../utils/meuMundoMotion");

function code(seq) {
  return `bairro-${String(seq).padStart(4, "0")}`;
}

async function session(idUser, residence, body, name) {
  const reservation = await realtime.reserveSeat({
    neighborhoodId: residence.id_neighborhood,
    userId: idUser,
    name,
    body,
  });
  return { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation };
}

class MeuMundoService {
  static async enter(idUser) {
    const { residence, created } = await MeuMundoStorage.ensureResidence(pool, idUser);
    const [houses, residents, body, name] = await Promise.all([
      MeuMundoStorage.listHouses(pool, residence.id_neighborhood, idUser),
      MeuMundoStorage.countResidents(pool, residence.id_neighborhood),
      MeuMundoStorage.getBody(pool, idUser),
      MeuMundoStorage.getPublicName(pool, idUser),
    ]);
    let multiplayer = null;
    try {
      multiplayer = await session(idUser, residence, body, name);
    } catch (err) {
      multiplayer = { error: err.message };
    }
    return {
      release: MEU_MUNDO_RELEASE,
      demo: false,
      environment: "dev",
      neighborhood: buildNeighborhoodPayload({
        code: code(residence.seq),
        name: residence.name,
        houses,
        residents,
      }),
      me: {
        name,
        body,
        house: residence.lot_number,
        newResidence: created,
        home: frontOfHouse(residence.lot_number),
      },
      motion: { walkSpeed: MOTION.WALK_SPEED, runSpeed: MOTION.RUN_SPEED },
      multiplayer,
    };
  }

  /** Nova reserva para (re)conectar: revalida tudo, nunca aloca outra casa. */
  static async reconnect(idUser) {
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!residence) return { error: "Sem residência ativa", statusCode: 409 };
    const [body, name] = await Promise.all([
      MeuMundoStorage.getBody(pool, idUser),
      MeuMundoStorage.getPublicName(pool, idUser),
    ]);
    try {
      return { multiplayer: await session(idUser, residence, body, name) };
    } catch (err) {
      return { error: err.message, statusCode: 503 };
    }
  }

  static async status() {
    return realtime.status();
  }
}

module.exports = MeuMundoService;
