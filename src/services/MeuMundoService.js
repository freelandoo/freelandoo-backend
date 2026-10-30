// src/services/MeuMundoService.js — MEU MUNDO 3D (migs 291–293).
//
// Quem chama já passou por auth + papel Administrator.
//
// ═══ ONDE A PESSOA ENTRA ═══ (`enter` e `reconnect` usam a MESMA decisão)
//  1. dentro de uma casa, se foi lá que ela estava há pouco (atualizar a
//     página, cair e voltar dentro da tolerância) e AINDA pode estar lá;
//  2. senão, na rua do bairro da casa visitada, se tiver visita ativa;
//  3. senão, na rua do próprio bairro.
// O destino é decidido aqui e reservado na sala certa; o navegador só consome
// a reserva. Toda transição (entrar na casa, sair, aceitar convite, voltar
// para casa) grava o destino autorizado antes de reservar o seguinte.
//
// ═══ VISITAS ═══ (mig 293, regras em src/utils/meuMundoVisits.js)
// Um convidado por anfitrião, uma visita ativa por pessoa, ninguém se
// convida, quem está visitando não convida. Aceitar revalida tudo numa
// transação travada; o banco tem a última palavra (índices únicos parciais).

const pool = require("../databases");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const MeuMundoVisitStorage = require("../storages/MeuMundoVisitStorage");
const MeuMundoVehicleStorage = require("../storages/MeuMundoVehicleStorage");
const AuthStorage = require("../storages/AuthStorage");
const realtime = require("../realtime/meuMundo");
const presence = require("../realtime/meuMundoPresence");
const { reserveJetpackSeat, leaveJetpack } = require("../realtime/meuMundoJetpack");
const { reservePaintSeat, leavePaint } = require("../realtime/meuMundoPaint");
const { reserveCorridaSeat, leaveCorrida } = require("../realtime/meuMundoCorrida");
const { reserveNoturnoSeat, leaveNoturno } = require("../realtime/meuMundoNoturno");
const { reserveGincanaSeat, leaveGincana } = require("../realtime/meuMundoGincana");
const { PAINT_MODES } = require("../utils/meuMundoPaint");
const {
  MEU_MUNDO_RELEASE,
  buildNeighborhoodPayload,
  frontOfHouse,
  isSelectableLevel,
  LAYOUT_VERSION,
  levelDef,
  lotToWorld,
  LOTS,
  LOT_PLAN,
  MAX_LEVEL,
} = require("../utils/meuMundoLayout");
const { interiorFor } = require("../utils/meuMundoInteriors");
const { VISIT_RULES } = require("../utils/meuMundoVisits");
const { MOTION } = require("../utils/meuMundoMotion");
const { kindOfId, spotFor } = require("../utils/meuMundoCars");
const { buildCenterPayload, PLACES: CENTER_PLACES } = require("../utils/meuMundoCenter");
const { PARTY } = require("../utils/meuMundoJetpack");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const MeuMundoLifeStorage = require("../storages/MeuMundoLifeStorage");
const Inbox = require("../storages/MeuMundoInboxStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.service");

/** Vida do hóspede para o payload de entrada; falhar aqui não impede entrar. */
async function lifeFor(idUser) {
  try {
    const out = await MeuMundoLifeService.peek(idUser);
    return { now: out.now, character: out.character, wallet: out.wallet };
  } catch (err) {
    log.error("life.peek_fail", { message: err.message });
    return null;
  }
}

const VISIT_LOCK = "meu_mundo:visitas";

// Viagem ao centro em andamento por pessoa (pedido repetido não cria duas).
const traveling = new Map(); // id do usuário → ms do início
const TRAVEL_GUARD_MS = 8000;
// Jetpack em grupo (mm3d-21): só entra quem está a até 6 m da área de interação da porta.
const JETPACK_DOOR = CENTER_PLACES.find((p) => p.id === "jetpack").interact;
const JETPACK_REACH = 6;
// Paint (mm3d-35): a mesma regra de porta.
const PAINT_DOOR = CENTER_PLACES.find((p) => p.id === "paint").interact;
// Corrida em grupo (mm3d-39b): a mesma regra de porta.
const CORRIDA_DOOR = CENTER_PLACES.find((p) => p.id === "corrida").interact;
// Rolê Noturno em grupo (mm3d-42): a mesma regra de porta.
const NOTURNO_DOOR = CENTER_PLACES.find((p) => p.id === "noturno").interact;
// Gincana em grupo (mm3d-47): a mesma regra de porta.
const GINCANA_DOOR = CENTER_PLACES.find((p) => p.id === "gincana").interact;
function beginTravel(idUser) {
  const t = traveling.get(idUser);
  if (t && Date.now() - t < TRAVEL_GUARD_MS) return false;
  traveling.set(idUser, Date.now());
  return true;
}
const endTravel = (idUser) => traveling.delete(idUser);

function code(seq) {
  return `bairro-${String(seq).padStart(4, "0")}`;
}
const pad2 = (n) => String(n).padStart(2, "0");

/** Ponto em frente à porta da casa (no mundo), para conferir proximidade. */
function doorPoint(lotNumber, level) {
  const def = levelDef(level);
  const o = def.origin;
  const d = def.door ?? o;
  return lotToWorld(LOTS[lotNumber - 1], d.x, o.z - 0.6);
}

/**
 * Ponto da PLACA do lote: é onde a tela oferece o menu da casa (world.ts,
 * lotStatic, raio 3,6). Entrar vale perto da porta OU da placa; senão o
 * botão que aparece na calçada responderia "chegue mais perto".
 */
function signPoint(lotNumber) {
  return lotToWorld(LOTS[lotNumber - 1], LOT_PLAN.sign.x - 1.3, LOT_PLAN.access.z + 1.2);
}
const SIGN_RADIUS = 4.2;

/** Interior para a rede: sem os problemas de conferência (vazios em produção). */
function publicInterior(def) {
  // eslint-disable-next-line no-unused-vars
  const { problems, ...rest } = def;
  return rest;
}

const inviteLog = new Map(); // id do anfitrião → [ms de cada convite]
function rateOk(idHost) {
  const now = Date.now();
  const list = (inviteLog.get(idHost) || []).filter((t) => now - t < 60000);
  if (list.length >= VISIT_RULES.invitesPerMinute) {
    inviteLog.set(idHost, list);
    return false;
  }
  list.push(now);
  inviteLog.set(idHost, list);
  return true;
}

class MeuMundoService {
  // ── Decisão do ambiente ────────────────────────────────────────────────────
  static async resolveScene(idUser, residence) {
    const pl = presence.getPlacement(idUser);
    // 0. No centro (mm3d-17): conectado lá, ou caiu e a sala ainda guarda a vaga dele.
    if (pl && pl.scene === "center") {
      const here = presence.get(idUser);
      if ((here && here.scene === "center") || (pl.roomId && realtime.hasCenterHold(pl.roomId, idUser))) {
        return { scene: "center", roomId: (here && here.scene === "center" && here.id) || pl.roomId || null };
      }
      // Passou do prazo: volta para casa (os veículos já voltaram com a vaga).
      presence.setPlacement(idUser, { scene: "nb", nbId: residence.id_neighborhood, arrivalLot: residence.lot_number });
      return MeuMundoService.resolveScene(idUser, residence);
    }
    const visit = await MeuMundoVisitStorage.activeAsGuest(pool, idUser);
    // 1. Dentro de uma casa há pouco, e ainda autorizado.
    if (pl && pl.scene === "house" && presence.offlineFor(idUser) <= VISIT_RULES.disconnectGraceMs) {
      const house = await MeuMundoStorage.getHouse(pool, pl.houseId);
      const allowed =
        house && (house.owner_id === idUser || (visit && visit.id_house === house.id_house && visit.id_host === house.owner_id));
      if (allowed && interiorFor(levelDef(house.level).level)) return { scene: "house", house };
    }
    // 1b. Deitado/dormindo numa cama (mm3d-13): o hóspede continua lá mesmo
    // com o jogo fechado — quem volta entra na casa, onde ele está.
    const bed = await MeuMundoLifeStorage.restingBed(pool, idUser);
    if (bed) {
      const house = await MeuMundoStorage.getHouse(pool, bed.houseId);
      const allowed =
        house && (house.owner_id === idUser || (visit && visit.id_house === house.id_house && visit.id_host === house.owner_id));
      if (allowed && interiorFor(levelDef(house.level).level)) return { scene: "house", house };
    }
    // 2/3. Rua: do bairro visitado (visita ativa) ou do próprio.
    const nbId = visit ? visit.id_neighborhood : residence.id_neighborhood;
    const arrivalLot = pl && pl.scene === "nb" && pl.nbId === nbId && pl.arrivalLot ? pl.arrivalLot : null;
    // Saiu de casa montado (mm3d-15): chega em cima do veículo.
    const ride = arrivalLot && pl.ride ? pl.ride : 0;
    return { scene: "nb", nbId, visit, arrivalLot, ride };
  }

  static async neighborhoodPayload(idUser, residence, target, body, name, life) {
    const nbRow = await pool.query(`SELECT id_neighborhood, seq, name FROM tb_mm_neighborhood WHERE id_neighborhood = $1`, [
      target.nbId,
    ]);
    const nb = nbRow.rows[0];
    const [houses, residents] = await Promise.all([
      MeuMundoStorage.listHouses(pool, target.nbId, idUser),
      MeuMundoStorage.countResidents(pool, target.nbId),
    ]);
    const visitor = !!target.visit && target.visit.id_neighborhood !== residence.id_neighborhood;
    let multiplayer = null;
    try {
      const reservation = await realtime.reserveSeat({
        neighborhoodId: target.nbId,
        userId: idUser,
        name,
        body,
        arrivalLot: target.arrivalLot,
        ride: target.ride || 0,
      });
      multiplayer = { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation };
      // A chegada vale UMA vez (a próxima entrada volta à regra normal).
      presence.setPlacement(idUser, { scene: "nb", nbId: target.nbId });
    } catch (err) {
      multiplayer = { error: err.message };
    }
    const spawnLot = target.arrivalLot || (visitor ? target.visit.lot_number : residence.lot_number);
    return {
      scene: "neighborhood",
      sceneKey: `nb:${target.nbId}`,
      release: MEU_MUNDO_RELEASE,
      demo: false,
      environment: "dev",
      neighborhood: buildNeighborhoodPayload({ code: code(nb.seq), name: nb.name, houses, residents }),
      me: {
        name,
        body,
        look: await MeuMundoStorage.getLook(pool, idUser),
        // Visitante: "house" continua sendo a casa DELE (em outro bairro);
        // `visiting` diz qual casa daqui ele pode visitar.
        house: residence.lot_number,
        newResidence: false,
        home: frontOfHouse(spawnLot),
        visitor,
        visiting: target.visit ? { house: target.visit.lot_number, hostName: target.visit.host_name } : null,
        homeNeighborhood: residence.id_neighborhood === target.nbId,
      },
      motion: { walkSpeed: MOTION.WALK_SPEED, runSpeed: MOTION.RUN_SPEED },
      multiplayer,
      visits: await MeuMundoService.visitState(idUser),
      life: life !== undefined ? life : await lifeFor(idUser),
    };
  }

  static async housePayload(idUser, house, body, name, life, ride = 0) {
    const level = levelDef(house.level).level;
    const def = interiorFor(level);
    let multiplayer = null;
    try {
      const reservation = await realtime.reserveHouseSeat({ houseId: house.id_house, userId: idUser, name, body, ride });
      multiplayer = { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation };
    } catch (err) {
      multiplayer = { error: err.message };
    }
    presence.setPlacement(idUser, { scene: "house", houseId: house.id_house, nbId: house.id_neighborhood, lot: house.lot_number });
    return {
      scene: "house",
      sceneKey: `house:${house.id_house}`,
      release: MEU_MUNDO_RELEASE,
      environment: "dev",
      house: {
        id: `house-${pad2(house.lot_number)}`,
        number: house.lot_number,
        level,
        ownerName: (house.owner_name || "morador").slice(0, 24),
        neighborhoodName: house.neighborhood_name,
        isMine: house.owner_id === idUser,
      },
      interior: publicInterior(def),
      me: { name, body, look: await MeuMundoStorage.getLook(pool, idUser), role: house.owner_id === idUser ? "owner" : "guest" },
      motion: { walkSpeed: MOTION.WALK_SPEED, runSpeed: MOTION.RUN_SPEED },
      multiplayer,
      visits: await MeuMundoService.visitState(idUser),
      life: life !== undefined ? life : await lifeFor(idUser),
    };
  }

  static async enter(idUser) {
    const { residence, created } = await MeuMundoStorage.ensureResidence(pool, idUser);
    // A vida vem ANTES do corpo: ler a vida grava o tipo físico atual (ele
    // não se escolhe — sai da alimentação e do treino).
    const life = await lifeFor(idUser);
    const [body, name] = await Promise.all([MeuMundoStorage.getBody(pool, idUser), MeuMundoStorage.getPublicName(pool, idUser)]);
    const target = await MeuMundoService.resolveScene(idUser, residence);
    const out =
      target.scene === "center"
        ? await MeuMundoService.centerPayload(idUser, residence, body, name, life, { roomId: target.roomId })
        : target.scene === "house"
          ? await MeuMundoService.housePayload(idUser, target.house, body, name, life)
          : await MeuMundoService.neighborhoodPayload(idUser, residence, target, body, name, life);
    if (out.error) return out;
    if (out.me) out.me.newResidence = created;
    // Cores do personagem (mm3d-36): um aviso no sino, uma vez por conta.
    try {
      const n = await Inbox.insertNotice(pool, idUser, { kind: "life", code: "colors_hint", priority: 4, data: {}, dedupeKey: "colors-hint" });
      if (n) require("./MeuMundoInboxService").push(idUser, n);
    } catch (err) {
      log.warn("colors_hint_fail", { message: err.message });
    }
    return out;
  }

  /**
   * Nova reserva para (re)conectar: revalida tudo, nunca aloca outra casa.
   * `sceneKey` diz em que ambiente ela vale — se não for o que o cliente está
   * mostrando (a visita acabou enquanto ele estava fora, por exemplo), o
   * cliente troca de ambiente em vez de entrar na sala errada.
   */
  static async reconnect(idUser) {
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!residence) return { error: "Sem residência ativa", statusCode: 409 };
    const [body, name] = await Promise.all([MeuMundoStorage.getBody(pool, idUser), MeuMundoStorage.getPublicName(pool, idUser)]);
    const target = await MeuMundoService.resolveScene(idUser, residence);
    try {
      if (target.scene === "center") {
        const reservation = await realtime.reserveCenterSeat({ userId: idUser, name, body, roomId: target.roomId });
        return { sceneKey: `center:${reservation.roomId}`, multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation } };
      }
      if (target.scene === "house") {
        const reservation = await realtime.reserveHouseSeat({ houseId: target.house.id_house, userId: idUser, name, body });
        return { sceneKey: `house:${target.house.id_house}`, multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation } };
      }
      const reservation = await realtime.reserveSeat({
        neighborhoodId: target.nbId,
        userId: idUser,
        name,
        body,
        arrivalLot: target.arrivalLot,
        ride: target.ride || 0,
      });
      return { sceneKey: `nb:${target.nbId}`, multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation } };
    } catch (err) {
      return { error: err.message, statusCode: 503 };
    }
  }

  // ── Casa: entrar e sair ───────────────────────────────────────────────────
  /**
   * Entrar na casa do lote `lot` do bairro em que a pessoa ESTÁ. Exige estar
   * na rua daquele bairro, perto da porta (posição do servidor, nunca a do
   * cliente), e ser o titular ou ter visita ativa para aquela casa.
   */
  static async enterHouse(idUser, rawLot) {
    const lot = Number(rawLot);
    if (!Number.isInteger(lot) || lot < 1 || lot > 20) return { error: "Casa inválida", statusCode: 400 };
    const here = presence.get(idUser);
    if (!here || here.scene !== "nb") return { error: "Você precisa estar na rua do bairro", statusCode: 409 };
    const house = await MeuMundoStorage.getHouseByLot(pool, here.id, lot);
    if (!house) return { error: "Casa não encontrada", statusCode: 404 };
    const isOwner = house.owner_id === idUser;
    if (!isOwner) {
      const visit = await MeuMundoVisitStorage.activeAsGuest(pool, idUser);
      if (!visit || visit.id_house !== house.id_house) return { error: "Esta casa precisa de convite do morador", statusCode: 403 };
    }
    const pos = realtime.positionIn("nb", here.id, idUser);
    // Bike, skate e patins entram em casa com a pessoa (mm3d-15); o carro, não.
    const rideKind = pos && pos.car ? kindOfId(pos.car) : null;
    if (pos && pos.driving && (!rideKind || rideKind === "car")) return { error: "De carro não dá para entrar em casa — desça dele primeiro", statusCode: 409 };
    const door = doorPoint(lot, house.level);
    const sign = signPoint(lot);
    const nearDoor = pos && Math.hypot(pos.x - door.x, pos.z - door.z) <= VISIT_RULES.enterRadius;
    const nearSign = pos && Math.hypot(pos.x - sign.x, pos.z - sign.z) <= SIGN_RADIUS;
    if (!nearDoor && !nearSign) {
      return { error: "Chegue mais perto da porta", statusCode: 409 };
    }
    const def = interiorFor(levelDef(house.level).level);
    if (!def) return { error: "Este nível ainda não tem interior", statusCode: 409 };
    let ride = 0;
    if (rideKind) {
      const st = realtime.stowRide(here.id, idUser);
      if (st.error === "moving") return { error: "Pare antes de entrar em casa", statusCode: 409 };
      if (st.error) return { error: "Não foi possível entrar com o veículo", statusCode: 409 };
      ride = st.id;
      // Guardado na entrada da casa; a pessoa entra em cima dele.
      const e = def.entry;
      const at = { x: e.x, z: e.z, facing: e.facing, floor: e.floor };
      await MeuMundoVehicleStorage.save(pool, here.id, ride, { ...at, houseId: house.id_house, layout: LAYOUT_VERSION });
      realtime.addRideToHouse(house.id_house, ride, at);
    }
    const [body, name] = await Promise.all([MeuMundoStorage.getBody(pool, idUser), MeuMundoStorage.getPublicName(pool, idUser)]);
    log.info("house.enter", { lot, owner: isOwner, ride: rideKind || "" });
    return MeuMundoService.housePayload(idUser, house, body, name, undefined, ride);
  }

  /** Sair pela porta: volta à frente da casa, no bairro dela. */
  static async exitHouse(idUser) {
    const here = presence.get(idUser);
    const pl = presence.getPlacement(idUser);
    const houseId = here && here.scene === "house" ? here.id : pl && pl.scene === "house" ? pl.houseId : null;
    if (!houseId) return { error: "Você não está numa casa", statusCode: 409 };
    const house = await MeuMundoStorage.getHouse(pool, houseId);
    if (!house) return { error: "Casa não encontrada", statusCode: 404 };
    if (here && here.scene === "house") {
      const def = interiorFor(levelDef(house.level).level);
      const pos = realtime.positionIn("house", houseId, idUser);
      if (!pos || pos.floor !== def.exit.floor || Math.hypot(pos.x - def.exit.x, pos.z - def.exit.z) > def.exit.radius + 0.6) {
        return { error: "Vá até a porta para sair", statusCode: 409 };
      }
    }
    // Montado (mm3d-15): o veículo sai junto e fica na frente da casa.
    const ride = realtime.takeRideOut(houseId, idUser);
    if (ride) {
      const front = frontOfHouse(house.lot_number);
      const at = { x: front.x, z: front.z, facing: front.rotationY };
      await MeuMundoVehicleStorage.save(pool, house.id_neighborhood, ride, { ...at, houseId: null, layout: LAYOUT_VERSION });
      realtime.releaseRide(house.id_neighborhood, ride, at);
    }
    realtime.dropFromHouse(houseId, idUser);
    presence.setPlacement(idUser, { scene: "nb", nbId: house.id_neighborhood, arrivalLot: house.lot_number, ride });
    log.info("house.exit", { lot: house.lot_number, ride });
    return MeuMundoService.enter(idUser);
  }

  // ── Centro da cidade (mm3d-17) ────────────────────────────────────────────
  /**
   * Payload do centro + reserva numa sala de até 20 (a planta é a mesma para
   * todas). Sem reserva (multiplayer fora), devolve { error } — quem chama
   * decide voltar à origem.
   */
  static async centerPayload(idUser, residence, body, name, life, { roomId = null, vehicle = null } = {}) {
    let reservation;
    try {
      reservation = await realtime.reserveCenterSeat({ userId: idUser, name, body, vehicle, roomId });
    } catch (err) {
      log.error("center.reserve_fail", { message: err.message });
      return { error: "O centro não abriu agora. Tente de novo.", statusCode: 503 };
    }
    return {
      scene: "center",
      sceneKey: `center:${reservation.roomId}`,
      release: MEU_MUNDO_RELEASE,
      environment: "dev",
      center: buildCenterPayload(),
      me: { name, body, look: await MeuMundoStorage.getLook(pool, idUser), house: 0, driving: vehicle ? Number(vehicle.id) : 0 },
      motion: { walkSpeed: MOTION.WALK_SPEED, runSpeed: MOTION.RUN_SPEED },
      multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation },
      visits: await MeuMundoService.visitState(idUser),
      life: life !== undefined ? life : await lifeFor(idUser),
    };
  }

  /**
   * Ir ao centro: da rua de um bairro (nunca como convidado de visita), a pé,
   * montado ou dirigindo — o veículo vai junto e o bairro grava onde ele
   * estava. O servidor reserva o centro ANTES de soltar o bairro; se a
   * reserva falhar, nada muda (o veículo volta para o mesmo lugar). Bairro,
   * lote, casa e residência não mudam.
   */
  static async travelToCenter(idUser) {
    const here = presence.get(idUser);
    if (!here || here.scene !== "nb") {
      return here && here.scene === "center"
        ? { error: "Você já está no centro", statusCode: 409, code: "already" }
        : { error: "Saia para a rua do bairro para ir ao centro", statusCode: 409 };
    }
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!residence) return { error: "Sem residência ativa", statusCode: 409 };
    if (await MeuMundoVisitStorage.activeAsGuest(pool, idUser)) {
      return { error: "Encerre a visita antes de ir ao centro", statusCode: 409, code: "visiting" };
    }
    if (!beginTravel(idUser)) return { error: "Você já está a caminho do centro", statusCode: 409, code: "busy" };
    try {
      const nbId = here.id;
      const pos = realtime.positionIn("nb", nbId, idUser);
      let vehicle = null;
      if (pos && pos.driving) {
        const r = realtime.sendVehicleAway(nbId, idUser);
        if (r.error === "moving") return { error: "Pare antes de ir ao centro", statusCode: 409, code: "moving" };
        if (r.error) return { error: "Não foi possível levar o veículo", statusCode: 409 };
        vehicle = { nbId, id: r.id, kind: r.kind };
      }
      const [body, name] = await Promise.all([MeuMundoStorage.getBody(pool, idUser), MeuMundoStorage.getPublicName(pool, idUser)]);
      const before = presence.getPlacement(idUser);
      presence.setPlacement(idUser, { scene: "center", roomId: null, from: { nbId } });
      const out = await MeuMundoService.centerPayload(idUser, residence, body, name, undefined, { vehicle });
      if (out.error) {
        // Falhou: tudo volta como estava (o veículo, para onde saiu).
        if (vehicle) realtime.returnAway(nbId, vehicle.id, null);
        presence.setPlacement(idUser, before || { scene: "nb", nbId });
        return out;
      }
      log.info("center.travel", { vehicle: vehicle ? vehicle.kind : "" });
      return out;
    } finally {
      endTravel(idUser);
    }
  }

  /**
   * Voltar para casa: o servidor decide o bairro (residência ativa do token —
   * o corpo da requisição é ignorado). Chega na frente da própria casa; quem
   * volta dirigindo chega com o carro na vaga dele (bike, skate e patins na
   * frente da casa). Não dá acesso à casa de ninguém.
   */
  static async returnHome(idUser) {
    const here = presence.get(idUser);
    const pl = presence.getPlacement(idUser);
    if (!(here && here.scene === "center") && !(pl && pl.scene === "center")) return { error: "Você não está no centro", statusCode: 409 };
    const roomId = here && here.scene === "center" ? here.id : pl.roomId;
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!residence) return { error: "Sem residência ativa", statusCode: 409 };
    let ride = 0;
    if (roomId) {
      const pos = realtime.positionIn("center", roomId, idUser);
      if (pos && pos.driving) {
        const r = realtime.takeDrivenFromCenter(roomId, idUser);
        if (r.error === "moving") return { error: "Pare antes de voltar para casa", statusCode: 409, code: "moving" };
        if (!r.error) {
          const front = frontOfHouse(residence.lot_number);
          const at = r.kind === "car" ? spotFor("car", ((r.id - 1) % 20) + 1) : { x: front.x, z: front.z, facing: front.rotationY };
          await MeuMundoVehicleStorage.save(pool, r.nbId, r.id, { x: at.x, z: at.z, facing: at.facing, houseId: null, layout: LAYOUT_VERSION });
          realtime.returnAway(r.nbId, r.id, at);
          // Chega montado/dirigindo no bairro de casa (convidado de visita não viaja).
          if (r.nbId === residence.id_neighborhood) ride = r.id;
        }
      }
      realtime.leaveCenter(roomId, idUser);
    }
    leaveJetpack(idUser);
    leavePaint(idUser);
    leaveCorrida(idUser);
    leaveNoturno(idUser);
    leaveGincana(idUser);
    presence.setPlacement(idUser, { scene: "nb", nbId: residence.id_neighborhood, arrivalLot: residence.lot_number, ride });
    log.info("center.return", { ride: ride ? kindOfId(ride) : "" });
    return MeuMundoService.enter(idUser);
  }

  // ── Jetpack em grupo (mm3d-21) ────────────────────────────────────────────
  /**
   * Lugar na sala do jetpack (até 4) do centro em que a pessoa está, só perto
   * da porta. A pessoa continua no centro (o avatar fica na porta). `roomId` =
   * estava numa sala do jetpack há pouco (reconexão): volta ao mesmo jogador.
   * Sem reserva, o cliente joga sozinho (single-player local).
   */
  static async joinJetpack(idUser, { roomId = null } = {}) {
    const here = presence.get(idUser);
    if (!here || here.scene !== "center") return { error: "Você não está no centro", statusCode: 409 };
    const pos = realtime.positionIn("center", here.id, idUser);
    if (!pos || Math.hypot(pos.x - JETPACK_DOOR.x, pos.z - JETPACK_DOOR.z) > JETPACK_REACH) {
      return { error: "Chegue perto da porta do jetpack", statusCode: 409, code: "far" };
    }
    const [body, name] = await Promise.all([MeuMundoStorage.getBody(pool, idUser), MeuMundoStorage.getPublicName(pool, idUser)]);
    let reservation;
    try {
      reservation = await reserveJetpackSeat({ userId: idUser, name, body, centerRoomId: here.id, roomId: typeof roomId === "string" ? roomId : null });
    } catch (err) {
      log.error("jetpack.reserve_fail", { message: err.message });
      return { error: "O jetpack em grupo não abriu agora.", statusCode: 503 };
    }
    return { multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation }, party: { max: PARTY.max } };
  }

  // ── Paint (mm3d-35) ───────────────────────────────────────────────────────
  /**
   * Lugar numa sala do Paint do centro em que a pessoa está, perto da porta:
   * treino (sala só sua), 1×1, 2×2 ou 3×3. A pessoa continua no centro.
   * `roomId` = estava numa sala do Paint há pouco (reconexão).
   */
  static async joinPaint(idUser, { mode = "solo", roomId = null } = {}) {
    if (!Object.prototype.hasOwnProperty.call(PAINT_MODES, mode)) return { error: "Modo inválido", statusCode: 400 };
    const here = presence.get(idUser);
    if (!here || here.scene !== "center") return { error: "Você não está no centro", statusCode: 409 };
    const pos = realtime.positionIn("center", here.id, idUser);
    if (!pos || Math.hypot(pos.x - PAINT_DOOR.x, pos.z - PAINT_DOOR.z) > JETPACK_REACH) {
      return { error: "Chegue perto da porta do Paint", statusCode: 409, code: "far" };
    }
    const [body, name] = await Promise.all([MeuMundoStorage.getBody(pool, idUser), MeuMundoStorage.getPublicName(pool, idUser)]);
    let reservation;
    try {
      reservation = await reservePaintSeat({ userId: idUser, name, body, centerRoomId: here.id, mode, roomId: typeof roomId === "string" ? roomId : null });
    } catch (err) {
      log.error("paint.reserve_fail", { message: err.message });
      return { error: "O Paint não abriu agora.", statusCode: 503 };
    }
    return { multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation }, mode };
  }

  // ── Corrida antigravidade em grupo (mm3d-39b) ─────────────────────────────
  /**
   * Lugar na próxima largada do centro em que a pessoa está, perto da porta.
   * A sala espera até 1 minuto por mais gente e completa 6 naves com o
   * computador. Sozinho não passa por aqui (é no aparelho).
   */
  static async joinCorrida(idUser, { ship } = {}) {
    const here = presence.get(idUser);
    if (!here || here.scene !== "center") return { error: "Você não está no centro", statusCode: 409 };
    const pos = realtime.positionIn("center", here.id, idUser);
    if (!pos || Math.hypot(pos.x - CORRIDA_DOOR.x, pos.z - CORRIDA_DOOR.z) > JETPACK_REACH) {
      return { error: "Chegue perto da porta da corrida", statusCode: 409, code: "far" };
    }
    const name = await MeuMundoStorage.getPublicName(pool, idUser);
    let reservation;
    try {
      reservation = await reserveCorridaSeat({ userId: idUser, name, centerRoomId: here.id, ship: typeof ship === "string" ? ship.slice(0, 24) : undefined });
    } catch (err) {
      log.error("corrida.reserve_fail", { message: err.message });
      return { error: "A corrida em grupo não abriu agora.", statusCode: 503 };
    }
    return { multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation } };
  }

  // ── Rolê Noturno em grupo (mm3d-42) ───────────────────────────────────────
  /** Lugar na próxima largada do Rolê do centro em que a pessoa está (veículo e corpo para os outros a desenharem). */
  static async joinNoturno(idUser, { ride, body } = {}) {
    const here = presence.get(idUser);
    if (!here || here.scene !== "center") return { error: "Você não está no centro", statusCode: 409 };
    const pos = realtime.positionIn("center", here.id, idUser);
    if (!pos || Math.hypot(pos.x - NOTURNO_DOOR.x, pos.z - NOTURNO_DOOR.z) > JETPACK_REACH) {
      return { error: "Chegue perto da porta do Rolê Noturno", statusCode: 409, code: "far" };
    }
    const name = await MeuMundoStorage.getPublicName(pool, idUser);
    let reservation;
    try {
      reservation = await reserveNoturnoSeat({ userId: idUser, name, centerRoomId: here.id, ride: String(ride || ""), body: String(body || "") });
    } catch (err) {
      log.error("noturno.reserve_fail", { message: err.message });
      return { error: "O rolê em grupo não abriu agora.", statusCode: 503 };
    }
    return { multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation } };
  }

  // ── Gincana em grupo (mm3d-47) ────────────────────────────────────────────
  /** Lugar na próxima largada da Gincana do centro em que a pessoa está (corpo para os outros a desenharem). */
  static async joinGincana(idUser, { body } = {}) {
    const here = presence.get(idUser);
    if (!here || here.scene !== "center") return { error: "Você não está no centro", statusCode: 409 };
    const pos = realtime.positionIn("center", here.id, idUser);
    if (!pos || Math.hypot(pos.x - GINCANA_DOOR.x, pos.z - GINCANA_DOOR.z) > JETPACK_REACH) {
      return { error: "Chegue perto da porta da Gincana", statusCode: 409, code: "far" };
    }
    const name = await MeuMundoStorage.getPublicName(pool, idUser);
    let reservation;
    try {
      reservation = await reserveGincanaSeat({ userId: idUser, name, centerRoomId: here.id, body: String(body || "") });
    } catch (err) {
      log.error("gincana.reserve_fail", { message: err.message });
      return { error: "A gincana em grupo não abriu agora.", statusCode: 503 };
    }
    return { multiplayer: { wsPath: realtime.WS_PREFIX.replace(/\/$/, ""), reservation } };
  }

  // ── Seletor de nível (teste) ──────────────────────────────────────────────
  /**
   * Seletor administrativo de TESTE do nível da casa (não é loja nem
   * evolução). A casa é sempre a da residência ativa de quem pede — o corpo
   * não carrega id de casa. Recusado com alguém DENTRO da casa: trocar piso e
   * móveis debaixo dos pés de alguém invalidaria posições e assentos.
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
    if (realtime.houseOccupants(residence.id_house) > 0) {
      return { error: "Peça para todos saírem da casa antes de trocar o nível", statusCode: 409, code: "occupied" };
    }
    const saved = await MeuMundoStorage.setHouseLevel(pool, residence.id_house, level);
    if (!saved) return { error: "Casa não encontrada", statusCode: 404 };
    try {
      realtime.applyHouseLevel(residence.id_neighborhood, residence.lot_number, saved.level, saved.level_rev);
    } catch (err) {
      log.error("house_level.broadcast_fail", { message: err.message });
    }
    return { house: residence.lot_number, level: saved.level, rev: saved.level_rev };
  }

  // ── Visitas ───────────────────────────────────────────────────────────────
  /** O que a pessoa precisa saber das visitas (nomes públicos, nunca ids de usuário). */
  static async visitState(idUser) {
    const rows = await MeuMundoVisitStorage.listLiveFor(pool, idUser);
    const now = Date.now();
    const pub = (v) => ({
      id: v.id_visit,
      status: v.status,
      hostName: (v.host_name || "morador").slice(0, 24),
      guestName: (v.guest_name || "morador").slice(0, 24),
      house: v.lot_number,
      neighborhoodName: v.neighborhood_name,
      expiresAt: new Date(v.expires_at).toISOString(),
      expiresIn: Math.max(0, new Date(v.expires_at).getTime() - now),
    });
    const outgoing = rows.find((v) => v.id_host === idUser && v.status === "pending");
    const incoming = rows.filter((v) => v.id_guest === idUser && v.status === "pending");
    const active = rows.find((v) => v.status === "active");
    return {
      outgoing: outgoing ? pub(outgoing) : null,
      incoming: incoming.map(pub),
      active: active ? { ...pub(active), role: active.id_host === idUser ? "host" : "guest" } : null,
      rules: { inviteTtlMs: VISIT_RULES.inviteTtlMs, disconnectGraceMs: VISIT_RULES.disconnectGraceMs },
    };
  }

  static async pushVisitState(...users) {
    for (const u of new Set(users)) {
      if (!u || !presence.get(u)) continue;
      try {
        presence.send(u, "visits", await MeuMundoService.visitState(u));
      } catch (err) {
        log.error("visits.push_fail", { message: err.message });
      }
    }
  }

  /**
   * Quem está online e pode receber convite agora. Só nome público e o
   * motivo de indisponibilidade — nada de id, e-mail ou bairro de terceiros.
   */
  static async inviteCandidates(idHost) {
    const out = [];
    for (const u of presence.onlineUsers()) {
      if (u === idHost) continue;
      if (!(await AuthStorage.isAdmin(pool, u))) continue;
      const name = await MeuMundoStorage.getPublicName(pool, u);
      const live = await MeuMundoVisitStorage.listLiveFor(pool, u);
      const busy = live.some((v) => v.status === "active");
      out.push({ name, available: !busy, reason: busy ? "in_visit" : null });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { candidates: out.slice(0, 50) };
  }

  static async invite(idHost, rawName) {
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 60) : "";
    if (!name) return { error: "Escolha quem convidar", statusCode: 400 };
    const residence = await MeuMundoStorage.getActiveResidence(pool, idHost);
    if (!residence) return { error: "Sem residência ativa", statusCode: 409 };
    const guest = await MeuMundoStorage.findUserByUsername(pool, name);
    if (!guest) return { error: "Pessoa não encontrada", statusCode: 404 };
    if (guest.id_user === idHost) return { error: "Você não pode convidar a si mesmo", statusCode: 400 };
    if (!(await AuthStorage.isAdmin(pool, guest.id_user))) return { error: "Esta pessoa ainda não tem acesso ao Meu Mundo", statusCode: 403 };
    if (!presence.get(guest.id_user)) return { error: "Esta pessoa não está no Meu Mundo agora", statusCode: 409, code: "offline" };
    if (await MeuMundoVisitStorage.activeAsGuest(pool, idHost)) return { error: "Você está visitando outra casa", statusCode: 409 };
    if (!rateOk(idHost)) return { error: "Muitos convites seguidos. Espere um pouco.", statusCode: 429 };
    const guestLive = await MeuMundoVisitStorage.listLiveFor(pool, guest.id_user);
    if (guestLive.some((v) => v.status === "active")) return { error: "Esta pessoa já está numa visita", statusCode: 409, code: "busy" };
    try {
      await MeuMundoVisitStorage.create(pool, {
        idHost,
        idGuest: guest.id_user,
        idHouse: residence.id_house,
        ttlMs: VISIT_RULES.inviteTtlMs,
      });
    } catch (err) {
      if (err.code === "23505") return { error: "Você já tem um convite pendente ou uma visita em andamento", statusCode: 409, code: "host_busy" };
      throw err;
    }
    log.info("visit.invite", { lot: residence.lot_number });
    await MeuMundoService.pushVisitState(idHost, guest.id_user);
    return { visit: await MeuMundoService.visitState(idHost) };
  }

  /** Tira o convidado de onde a visita o deixava (casa do anfitrião ou rua visitada). */
  static async evictGuest(visit, reason) {
    const guestRes = await MeuMundoStorage.getActiveResidence(pool, visit.id_guest);
    const here = presence.get(visit.id_guest);
    if (!here) {
      if (guestRes) presence.setPlacement(visit.id_guest, { scene: "nb", nbId: guestRes.id_neighborhood, arrivalLot: guestRes.lot_number });
      return;
    }
    const inHostHouse = here.scene === "house" && here.id === visit.id_house;
    const inHostStreet = here.scene === "nb" && here.id === visit.id_neighborhood;
    const sameNb = guestRes && guestRes.id_neighborhood === visit.id_neighborhood;
    if (!inHostHouse && !(inHostStreet && !sameNb)) return;
    if (guestRes) presence.setPlacement(visit.id_guest, { scene: "nb", nbId: guestRes.id_neighborhood, arrivalLot: guestRes.lot_number });
    presence.kick(visit.id_guest, {
      scene: here.scene,
      id: here.id,
      code: realtime.CLOSE.MOVED,
      message: { type: "visit_ended", payload: { reason, hostName: visit.host_name } },
    });
  }

  static async accept(idGuest, idVisit) {
    const c = await pool.connect();
    let visit;
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [VISIT_LOCK]);
      visit = await MeuMundoVisitStorage.getById(c, idVisit, true);
      const fail = async (error, statusCode, extra = {}) => {
        await c.query("ROLLBACK");
        return { error, statusCode, ...extra };
      };
      if (!visit || visit.id_guest !== idGuest) return await fail("Convite não encontrado", 404);
      if (visit.status === "active") return await fail("Este convite já foi aceito", 409, { code: "already" });
      if (visit.status !== "pending") return await fail("Este convite não vale mais", 410, { code: visit.status });
      if (new Date(visit.expires_at).getTime() <= Date.now()) {
        await MeuMundoVisitStorage.transition(c, idVisit, ["pending"], "expired", "timeout");
        await c.query("COMMIT");
        await MeuMundoService.pushVisitState(visit.id_host, idGuest);
        return { error: "Este convite expirou", statusCode: 410, code: "expired" };
      }
      // Anfitrião ainda é o titular da casa e não está visitando ninguém.
      const house = await MeuMundoStorage.getHouse(c, visit.id_house);
      if (!house || house.owner_id !== visit.id_host) return await fail("O anfitrião não mora mais nesta casa", 410);
      if (await MeuMundoVisitStorage.activeAsGuest(c, visit.id_host)) return await fail("O anfitrião está visitando outra casa", 409);
      // Convidado: nenhuma visita ativa (nem como anfitrião).
      const live = await MeuMundoVisitStorage.listLiveFor(c, idGuest);
      if (live.some((v) => v.status === "active")) return await fail("Você já está numa visita", 409);
      if (!(await MeuMundoVisitStorage.transition(c, idVisit, ["pending"], "active"))) return await fail("Este convite não vale mais", 410);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      if (err.code === "23505") return { error: "Você já está numa visita", statusCode: 409 };
      throw err;
    } finally {
      c.release();
    }
    log.info("visit.accept", { lot: visit.lot_number });
    await MeuMundoService.pushVisitState(visit.id_host, idGuest);
    // Mesmo bairro: nada de transferir — a casa é indicada e ele vai a pé.
    const guestRes = await MeuMundoStorage.getActiveResidence(pool, idGuest);
    if (guestRes && guestRes.id_neighborhood === visit.id_neighborhood) {
      return { stay: true, visits: await MeuMundoService.visitState(idGuest) };
    }
    // Outro bairro: chega na calçada da casa do anfitrião.
    presence.setPlacement(idGuest, { scene: "nb", nbId: visit.id_neighborhood, arrivalLot: visit.lot_number });
    return { stay: false, scene: await MeuMundoService.enter(idGuest) };
  }

  static async decline(idGuest, idVisit) {
    const v = await MeuMundoVisitStorage.getById(pool, idVisit);
    if (!v || v.id_guest !== idGuest) return { error: "Convite não encontrado", statusCode: 404 };
    if (!(await MeuMundoVisitStorage.transition(pool, idVisit, ["pending"], "declined", "declined"))) {
      return { error: "Este convite não vale mais", statusCode: 410 };
    }
    await MeuMundoService.pushVisitState(v.id_host, idGuest);
    return { ok: true };
  }

  static async cancel(idHost, idVisit) {
    const v = await MeuMundoVisitStorage.getById(pool, idVisit);
    if (!v || v.id_host !== idHost) return { error: "Convite não encontrado", statusCode: 404 };
    if (!(await MeuMundoVisitStorage.transition(pool, idVisit, ["pending"], "canceled", "host_canceled"))) {
      return { error: "Este convite não está mais pendente", statusCode: 410 };
    }
    await MeuMundoService.pushVisitState(idHost, v.id_guest);
    return { ok: true };
  }

  /**
   * Encerrar a visita ativa. Pelo anfitrião ("encerrar visita") ou pelo
   * convidado ("voltar para casa"). O convidado sai da casa/rua visitada e
   * volta para a frente da própria casa.
   */
  static async endVisit(idUser, idVisit, reason) {
    const v = await MeuMundoVisitStorage.getById(pool, idVisit);
    if (!v || (v.id_host !== idUser && v.id_guest !== idUser)) return { error: "Visita não encontrada", statusCode: 404 };
    const why = reason || (v.id_host === idUser ? "host_ended" : "guest_left");
    if (!(await MeuMundoVisitStorage.transition(pool, idVisit, ["active"], "ended", why))) {
      return { error: "Esta visita já terminou", statusCode: 410 };
    }
    log.info("visit.end", { reason: why });
    if (v.id_guest === idUser) {
      // "Voltar para casa": o próprio convidado vai; o cliente dele troca de
      // ambiente com a resposta.
      const res = await MeuMundoStorage.getActiveResidence(pool, idUser);
      if (res) presence.setPlacement(idUser, { scene: "nb", nbId: res.id_neighborhood, arrivalLot: res.lot_number });
      await MeuMundoService.pushVisitState(v.id_host);
      const here = presence.get(idUser);
      const leaving = here && ((here.scene === "house" && here.id === v.id_house) || (here.scene === "nb" && res && here.id !== res.id_neighborhood));
      return { ok: true, scene: leaving ? await MeuMundoService.enter(idUser) : null, visits: await MeuMundoService.visitState(idUser) };
    }
    await MeuMundoService.evictGuest(v, why);
    await MeuMundoService.pushVisitState(v.id_host, v.id_guest);
    return { ok: true };
  }

  /**
   * Varredura (a cada poucos segundos): convites vencidos expiram; visita
   * ativa com anfitrião ou convidado fora além da tolerância termina.
   */
  static async sweepVisits() {
    for (const v of await MeuMundoVisitStorage.expirePending(pool)) {
      await MeuMundoService.pushVisitState(v.id_host, v.id_guest);
    }
    const grace = VISIT_RULES.disconnectGraceMs;
    for (const v of await MeuMundoVisitStorage.activeList(pool)) {
      const hostOff = presence.offlineFor(v.id_host);
      const guestOff = presence.offlineFor(v.id_guest);
      // Anfitrião saiu do próprio bairro para outro destino: encerra.
      const host = presence.get(v.id_host);
      const hostAway =
        host && (host.scene === "center" || (host.scene === "nb" && host.id !== v.id_neighborhood) || (host.scene === "house" && host.id !== v.id_house));
      const reason = hostAway ? "host_left" : hostOff > grace ? "host_offline" : guestOff > grace ? "guest_offline" : null;
      if (!reason) continue;
      if (!(await MeuMundoVisitStorage.transition(pool, v.id_visit, ["active"], "ended", reason))) continue;
      log.info("visit.sweep_end", { reason });
      await MeuMundoService.evictGuest(v, reason);
      await MeuMundoService.pushVisitState(v.id_host, v.id_guest);
    }
  }

  static async status() {
    return realtime.status();
  }
}

let sweeper = null;
/** Liga a varredura das visitas (index.js, depois do multiplayer). */
MeuMundoService.startSweeper = (ms = 5000) => {
  if (sweeper) return;
  sweeper = setInterval(() => {
    MeuMundoService.sweepVisits().catch((err) => log.error("visits.sweep_fail", { message: err.message }));
    // Veículo que saiu para o centro e nunca chegou volta ao bairro.
    try {
      realtime.sweepAway();
    } catch (err) {
      log.error("vehicles.sweep_fail", { message: err.message });
    }
  }, ms);
  sweeper.unref?.();
};
MeuMundoService.stopSweeper = () => {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
};

module.exports = MeuMundoService;
