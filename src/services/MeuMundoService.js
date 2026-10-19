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
  isSelectableLevel,
  MAX_LEVEL,
} = require("../utils/meuMundoLayout");
const { MOTION } = require("../utils/meuMundoMotion");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.service");

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

  /**
   * Seletor administrativo de TESTE do nível da casa (não é loja nem
   * evolução). A casa é sempre a da residência ativa de quem pede — o corpo
   * não carrega id de casa, então não há como apontar para a casa de outra
   * pessoa. O nível é um NÚMERO conferido no catálogo do servidor; o cliente
   * nunca manda caminho de modelo.
   */
  static async setHouseLevel(idUser, rawLevel) {
    const level = Number(rawLevel);
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
      return { error: `Nível deve ser um número de 1 a ${MAX_LEVEL}`, statusCode: 400 };
    }
    if (!isSelectableLevel(level)) {
      return { error: "Este nível ainda não tem modelo", statusCode: 409 };
    }
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!residence) return { error: "Sem residência ativa", statusCode: 409 };
    const saved = await MeuMundoStorage.setHouseLevel(pool, residence.id_house, level);
    if (!saved) return { error: "Casa não encontrada", statusCode: 404 };
    // A sala do bairro (se houver alguém online) troca colisores, reposiciona
    // quem ficou dentro da casa nova e avisa todos. Falhar aqui não desfaz a
    // gravação: quem entrar depois recebe o nível do banco.
    try {
      realtime.applyHouseLevel(residence.id_neighborhood, residence.lot_number, saved.level, saved.level_rev);
    } catch (err) {
      log.error("house_level.broadcast_fail", { message: err.message });
    }
    return { house: residence.lot_number, level: saved.level, rev: saved.level_rev };
  }

  static async status() {
    return realtime.status();
  }
}

module.exports = MeuMundoService;
