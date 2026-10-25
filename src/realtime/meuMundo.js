// src/realtime/meuMundo.js — MEU MUNDO 3D: multiplayer do bairro e das casas (Colyseus 0.18).
//
// ═══ ONDE RODA ═══
// Dentro do processo do backend, no MESMO servidor HTTP (Railway, WebSocket
// duradouro). O transporte do Colyseus só aceita upgrades em `/mm-ws/...`;
// o socket.io continua em `/realtime`. Não existe rota HTTP de matchmaking
// exposta: a reserva de lugar é feita AQUI, chamada pelo endpoint autenticado
// `/meu-mundo/admin/*` — o navegador nunca escolhe sala nem diz quem é.
//
// ⚠️ PROCESSO ÚNICO. O matchmaker, a presença e os destinos usam memória
// local. Com mais de uma réplica do backend, dois processos poderiam abrir
// salas paralelas para o mesmo bairro ou a mesma casa. Escalar exige
// presença/driver compartilhados (Redis) — documentado no REGISTRO.md.
//
// ═══ DUAS SALAS ═══
// "bairro": uma por bairro ativo (`filterBy(['neighborhoodId'])`). Moradores
//   e visitantes de outros bairros com visita ATIVA (até um por titular).
// "casa" (mm3d-09): uma por casa OCUPADA (`filterBy(['houseId'])`). Titular e
//   no máximo um convidado. O layout é do NÍVEL (meuMundoInteriors.js); a
//   presença e os assentos são desta casa. Sala vazia é descartada; a casa,
//   o nível e o titular continuam no banco.
// Uma pessoa tem um avatar ativo por vez (meuMundoPresence.js): entrar numa
// sala encerra a presença na outra.
//
// ═══ O QUE TRAFEGA ═══
// Só nome público, posição, andar, orientação, estado de movimento, assento,
// cama, ritmo, corpo e número da casa. Nada de id de usuário, e-mail, token
// ou permissão. A VIDA do hóspede (mm3d-13) não trafega aqui: a sala só
// recebe o ritmo de caminhada (`pace`), se ele está numa cama e o tipo
// físico (`body`, que desde 2026-10-21 sai da alimentação e do treino — não
// se escolhe) — o resto o dono lê em GET /meu-mundo/admin/life.
// Modelos e animações nunca passam pelo WebSocket.

const { Server, Room, ServerError, matchMaker } = require("@colyseus/core");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const MeuMundoVisitStorage = require("../storages/MeuMundoVisitStorage");
const MeuMundoVehicleStorage = require("../storages/MeuMundoVehicleStorage");
const presence = require("./meuMundoPresence");
const jetpack = require("./meuMundoJetpack");
const { interiorFor } = require("../utils/meuMundoInteriors");
const { SEAT_REACH, BED_REACH } = require("../utils/meuMundoInteriorKit");
const MeuMundoLifeService = require("../services/MeuMundoLifeService");
const { stepInterior, isFreeSpot } = require("../utils/meuMundoInteriorMotion");
const {
  LIMIT,
  LAYOUT_VERSION,
  frontOfHouse,
  isSafeSpot,
  buildObstacles,
  houseBoxes,
  levelDef,
} = require("../utils/meuMundoLayout");
const { MOTION, sanitizeIntent, step, resolveCircle, paceSpeeds } = require("../utils/meuMundoMotion");
const { CAR, RIDE_KINDS, KIND_NAMES, vehicleId, kindOfId, spotFor, carBox, blocks, carFits, exitSpots } = require("../utils/meuMundoCars");
const {
  IDLE: IDLE_DRIVE,
  paramsFor,
  sanitizeDrive,
  sanitizeTuning,
  createVehicle,
} = require("../utils/meuMundoVehicle");
const { queueDrive, advanceDriven, settleDriven, expireDrive } = require("../utils/meuMundoDriveSync");
const {
  CENTER_VERSION,
  CENTER_CAPACITY,
  OBSTACLES: CENTER_OBSTACLES,
  LIMIT: CENTER_LIMIT,
  ARRIVAL: CENTER_ARRIVAL,
  ARRIVAL_SPOTS: CENTER_ARRIVAL_SPOTS,
  isSafeSpot: isCenterSafe,
} = require("../utils/meuMundoCenter");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.realtime");

const WS_PREFIX = "/mm-ws/";
const ROOM_NAME = "bairro";
const HOUSE_ROOM = "casa";
const SIM_MS = 50; // 20 Hz de simulação
const PATCH_MS = 100; // 10 Hz de estado para os clientes
// mm3d-27: o cliente repete a intenção a cada 1 s enquanto anda (KEEPALIVE_MS
// de net.ts). Sem notícia por mais que isto, a aba sumiu (segundo plano,
// celular travado): a pessoa para, em vez de andar sozinha até a parede.
const INTENT_STALE_MS = 2500;
const MAX_MSG_PER_SEC = 30;
const ABUSE_DROPS = 200; // mensagens descartadas em 10 s → desconecta
const LAST_POS_TTL = 10 * 60 * 1000;
const MAX_VISITORS = 20; // um visitante por titular (20 casas)
const LIFE_REFRESH_MS = 60 * 1000; // ritmo e cama acompanham a vida simulada

/** Perfil de `step` a pé com o ritmo do corpo (null = velocidades normais). */
function paceProfile(pace) {
  if (!(pace < 1)) return null;
  const sp = paceSpeeds(pace);
  return { walk: sp.walk, run: sp.run, accel: MOTION.ACCEL, radius: MOTION.RADIUS };
}

/** Traz a vida do usuário até agora; o serviço devolve o resultado à sala dele (applyLife). */
function refreshLife(userId) {
  MeuMundoLifeService.peek(userId).catch((err) => log.warn("life.refresh_fail", { message: err.message }));
}

// MOVED: o servidor levou a pessoa para outro ambiente (visita encerrada,
// por exemplo) — o cliente pede o destino novo ao backend.
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029, MOVED: 4011 };
// Saída pedida pelo cliente (room.leave(true)): não guarda vaga no centro.
const CLOSE_CONSENTED = 4000;

const Player = schema(
  {
    name: t.string(),
    house: t.uint8(),
    body: t.string(),
    x: t.float32(),
    z: t.float32(),
    facing: t.float32(),
    move: t.uint8(),
    // Id do veículo em uso (0 = a pé; 1–20 carro, 21–40 bike, 41–60 skate,
    // 61–80 patins — mm3d-14). Em uso, x/z são os do veículo; no carro o
    // boneco não aparece, nos outros aparece montado (move 6/7/8).
    car: t.uint8(),
    // Ritmo de caminhada pelo corpo (mm3d-13): 1 normal, 0,7 cansado, 0,42
    // exausto. O cliente usa na predição (paceSpeeds) e na pose cansada.
    pace: t.float32(),
  },
  "MMPlayer"
);
// Carro de uma casa (chave = número do lote). driver = sessionId de quem
// dirige ("" = estacionado). mm3d-12: sp = velocidade longitudinal (m/s, <0
// = ré), st = esterçamento das rodas (rad), hb = freio de mão puxado,
// sl = 0..1 quanto a traseira escorrega — o que os OUTROS precisam para
// animar rodas, curva e derrapagem sem rodar outra física. vx/vz (m/s) e w
// (rad/s): velocidade e giro, para o MOTORISTA reconciliar a previsão inteira
// (rumo e velocidade, não só a posição — engine/car-sync.ts).
const Car = schema(
  {
    lot: t.uint8(),
    // mm3d-14: "car" | "bike" | "skate" | "skates" (a chave do mapa é o id).
    kind: t.string(),
    x: t.float32(),
    z: t.float32(),
    facing: t.float32(),
    driver: t.string(),
    sp: t.float32(),
    st: t.float32(),
    hb: t.boolean(),
    sl: t.float32(),
    vx: t.float32(),
    vz: t.float32(),
    w: t.float32(),
  },
  "MMCar"
);
// Nível da casa: só o NÚMERO e a revisão trafegam — o modelo 3D nunca passa
// pelo WebSocket (o cliente resolve o número no catálogo que veio no payload).
const HouseLevel = schema({ level: t.uint8(), rev: t.uint32() }, "MMHouseLevel");

// mm3d-15: veículo pequeno (bike, skate, patins) guardado DENTRO da casa
// (chave = id do veículo). rider = sessionId de quem está montado ("" =
// parado); sp = velocidade (m/s) para os outros girarem as rodas.
const HouseRide = schema(
  {
    kind: t.string(),
    x: t.float32(),
    z: t.float32(),
    y: t.float32(),
    floor: t.uint8(),
    facing: t.float32(),
    rider: t.string(),
    sp: t.float32(),
  },
  "MMCasaRide"
);
// residents = titulares do bairro (permanentes); players = quem está online agora;
// houses = nível confirmado de cada casa (chave = número do lote).
const State = schema(
  { players: t.map(Player), residents: t.uint8(), houses: t.map(HouseLevel), cars: t.map(Car) },
  "MMBairro"
);

// Dentro da casa: andar, altura, assento e cama. move 3 = sentado, 4 =
// deitado, 5 = dormindo (mm3d-13).
const HousePlayer = schema(
  {
    name: t.string(),
    body: t.string(),
    host: t.boolean(),
    x: t.float32(),
    z: t.float32(),
    y: t.float32(),
    floor: t.uint8(),
    facing: t.float32(),
    move: t.uint8(),
    seat: t.string(),
    bed: t.string(),
    pace: t.float32(),
    // mm3d-15: id do veículo em que está montado (0 = a pé; move 6/7/8).
    ride: t.uint8(),
  },
  "MMCasaPlayer"
);
const HouseState = schema({ players: t.map(HousePlayer), level: t.uint8(), rides: t.map(HouseRide) }, "MMCasa");

/** Alcance para montar num veículo parado dentro de casa (m). */
const RIDE_REACH = 1.6;
/** Raio livre que um veículo parado precisa dentro de casa (m). */
const INTERIOR_RIDE_RADIUS = 0.3;

// Salas vivas (processo único — ver o topo do arquivo).
const roomsByNeighborhood = new Map();
const roomsByHouse = new Map();

// Última posição por (usuário, bairro): quem cai e volta em até 10 min
// retorna onde estava; depois disso, à frente da casa.
const lastPos = new Map();

function rememberPos(key, b) {
  lastPos.set(key, { x: b.x, z: b.z, facing: b.facing, at: Date.now(), layout: LAYOUT_VERSION });
  if (lastPos.size > 500) {
    const cut = Date.now() - LAST_POS_TTL;
    for (const [k, v] of lastPos) if (v.at < cut) lastPos.delete(k);
  }
}

/** Balde de fichas por cliente (as duas salas usam). */
function takeToken(client, s) {
  if (!s) return false;
  const now = Date.now();
  s.bucket = Math.min(MAX_MSG_PER_SEC, s.bucket + ((now - s.lastRefill) / 1000) * MAX_MSG_PER_SEC);
  s.lastRefill = now;
  if (s.bucket >= 1) {
    s.bucket -= 1;
    return true;
  }
  if (now - s.dropsSince > 10000) {
    s.drops = 0;
    s.dropsSince = now;
  }
  s.drops += 1;
  if (s.drops > ABUSE_DROPS) client.leave(CLOSE.ABUSE);
  return false;
}

const freshBucket = () => ({ bucket: MAX_MSG_PER_SEC, lastRefill: Date.now(), drops: 0, dropsSince: Date.now() });

/** Intenção de andar sem notícia (mm3d-27): a pessoa para. */
function expireIntent(s, now) {
  const it = s.intent;
  if (!it || (!it.x && !it.z) || now - (s.intentAt || 0) <= INTENT_STALE_MS) return;
  s.intent = { x: 0, z: 0, run: false };
}

class BairroRoom extends Room {
  async onCreate(options) {
    this.neighborhoodId = String(options.neighborhoodId || "");
    // 20 titulares + até 20 visitantes de outros bairros (um por titular),
    // com folga para reservas que ainda não conectaram e para a troca de
    // sessão (a nova entra antes de a antiga sair). Quem segura o limite de
    // visitantes é o onJoin, contando PESSOAS — não conexões.
    this.maxClients = 48;
    this.patchRate = PATCH_MS;
    this.seatReservationTimeout = 20;
    this.setState(new State());
    /** sessionId → dados que NÃO vão para a rede */
    this.sim = new Map();
    // Colisão DESTA sala: depende do nível de cada casa do bairro. O join só
    // acontece depois que o onCreate termina, então ninguém anda sem ela.
    // Registrada ANTES da leitura: uma troca que chegue enquanto o banco
    // responde entra no estado, e a leitura não a sobrescreve (revisão).
    this.obstacles = buildObstacles();
    roomsByNeighborhood.set(this.neighborhoodId, this);
    for (const row of await MeuMundoStorage.listHouseLevels(pool, this.neighborhoodId)) {
      const key = String(row.number);
      const cur = this.state.houses.get(key);
      if (cur && cur.rev >= (row.rev || 0)) continue;
      this.state.houses.set(key, new HouseLevel({ level: levelDef(row.level).level, rev: row.rev || 0 }));
    }
    const levels = new Map();
    this.state.houses.forEach((h, key) => levels.set(Number(key), h.level));
    this.obstacles = buildObstacles(levels);
    // Onde cada veículo ficou (mig 299): na rua, ou guardado dentro de uma
    // casa (esse não aparece aqui até sair de lá). Sem linha = na vaga.
    this.indoors = new Set();
    this.saved = new Map();
    for (const v of await MeuMundoVehicleStorage.listByNeighborhood(pool, this.neighborhoodId)) {
      if (v.houseId) this.indoors.add(v.id);
      else if (v.layout === LAYOUT_VERSION) this.saved.set(v.id, v);
    }
    // Cada casa com titular: carro na rua; bike, skate e patins na calçada.
    for (const h of await MeuMundoStorage.listHouses(pool, this.neighborhoodId, null)) {
      if (h.ownerName) this.ensureVehicles(h.number);
    }
    this.limit = LIMIT;
    this.startLoop();
    log.info("room.create", { roomId: this.roomId, neighborhood: this.neighborhoodId });
  }

  /** Mensagens, simulação e vida: iguais na rua do bairro e no centro (CentroRoom). */
  startLoop() {
    this.onMessage("in", (client, msg) => this.onIntent(client, msg));
    this.onMessage("car", (client, msg) => this.onCar(client, msg));
    this.onMessage("drive", (client, msg) => this.onDrive(client, msg));
    this.onMessage("tune", (client, msg) => this.onTune(client, msg));
    // Sem mensagem "body" desde 2026-10-21: o tipo físico vem da vida (applyLife).
    this.onMessage("*", (client) => this.countMessage(client));
    this.setSimulationInterval((dt) => this.tick(dt), SIM_MS);
    this.clock.setInterval(() => {
      for (const s of this.sim.values()) refreshLife(s.userId);
    }, LIFE_REFRESH_MS);
  }

  async onJoin(client, options) {
    // A reserva foi feita pelo backend autenticado; mesmo assim a identidade é
    // reconferida no banco no momento de entrar (papel, residência e visita),
    // porque entre a reserva e a conexão algo pode ter mudado.
    const userId = options.userId;
    const ok =
      options.neighborhoodId === this.neighborhoodId &&
      userId &&
      (await AuthStorage.isAdmin(pool, userId));
    const residence = ok ? await MeuMundoStorage.getActiveResidence(pool, userId) : null;
    const resident = !!residence && residence.id_neighborhood === this.neighborhoodId;
    // Visitante: só com visita ATIVA para uma casa DESTE bairro, conferida a
    // cada entrada — visita encerrada não deixa acesso para trás.
    const visit = ok && residence && !resident ? await MeuMundoVisitStorage.activeAsGuest(pool, userId) : null;
    const visitor = !!visit && visit.id_neighborhood === this.neighborhoodId;
    if (!resident && !visitor) {
      log.warn("join.denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao bairro");
    }
    if (visitor) {
      const others = new Set();
      for (const s of this.sim.values()) if (s.visitor && s.userId !== userId) others.add(s.userId);
      if (others.size >= MAX_VISITORS) throw new ServerError(CLOSE.FORBIDDEN, "bairro sem vaga de visitante");
    }

    // Uma sessão ativa por usuário: a nova substitui a antiga, com aviso.
    let start = null;
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId) continue;
      start = { x: s.body.x, z: s.body.z, facing: s.body.facing };
      const old = this.clients.find((c) => c.sessionId === sid);
      this.sim.delete(sid);
      this.state.players.delete(sid);
      if (old) {
        old.send("replaced", {});
        old.leave(CLOSE.REPLACED);
      }
    }
    // Chegada indicada pelo servidor (saindo de uma casa, chegando de visita).
    const arrival = Number(options.arrivalLot);
    if (Number.isInteger(arrival) && arrival >= 1 && arrival <= 20) {
      const front = frontOfHouse(arrival);
      start = { x: front.x, z: front.z, facing: front.rotationY };
    }
    if (!start) {
      const mem = lastPos.get(`${userId}|${this.neighborhoodId}`);
      // Posição de outro desenho do bairro não vale neste.
      if (mem && mem.layout === LAYOUT_VERSION && Date.now() - mem.at < LAST_POS_TTL) start = mem;
    }
    // Qualquer partida (sessão antiga, memória) precisa ser um lugar livre
    // dentro do bairro; senão a pessoa volta para a frente da casa.
    if (start && !isSafeSpot(start.x, start.z, resolveCircle, MOTION.RADIUS, this.obstacles)) {
      log.warn("join.unsafe_start", { roomId: this.roomId });
      start = null;
    }
    if (!start) {
      const home = frontOfHouse(visitor ? visit.lot_number : residence.lot_number);
      start = { x: home.x, z: home.z, facing: home.rotationY };
    }

    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    const b = { x: start.x, z: start.z, vx: 0, vz: 0, facing: start.facing };
    // Posição de partida também passa pela colisão (memória antiga num lugar
    // que virou obstáculo não pode prender ninguém).
    step(b, { x: 0, z: 0, run: false }, 0, this.obstacles, LIMIT);
    this.sim.set(client.sessionId, {
      userId,
      visitor,
      body: b,
      intent: { x: 0, z: 0, run: false },
      ...freshBucket(),
      car: 0,
      // Dirigindo (mm3d-12): física do carro, entrada e ajustes do painel.
      veh: null,
      drive: IDLE_DRIVE,
      tune: null,
      lastRecoverAt: 0,
      pace: 1,
    });
    this.state.players.set(
      client.sessionId,
      new Player({
        name: String(options.name || "morador").slice(0, 24),
        house: visitor ? 0 : residence.lot_number,
        body,
        x: b.x,
        z: b.z,
        facing: b.facing,
        move: 0,
        car: 0,
        pace: 1,
      })
    );
    if (resident) this.ensureVehicles(residence.lot_number);
    // Saindo de casa montado (mm3d-15): o veículo já foi posto na frente da
    // casa (releaseRide) — a pessoa chega em cima dele.
    // Voltando do centro dirigindo (mm3d-17): o carro já foi posto na vaga da
    // casa — a pessoa chega dentro dele.
    const ride = Number(options.ride);
    if (ride) {
      const c = this.state.cars.get(String(ride));
      const pl = this.state.players.get(client.sessionId);
      const reach = c && c.kind === "car" ? 12 : 2.5;
      if (c && !c.driver && Math.hypot(c.x - b.x, c.z - b.z) < reach) {
        this.mount(client.sessionId, this.sim.get(client.sessionId), pl, ride, c);
      }
    }
    // Titulares podem ter mudado (alguém acabou de ganhar uma casa aqui).
    this.state.residents = await MeuMundoStorage.countResidents(pool, this.neighborhoodId);
    presence.claim(userId, this, client.sessionId, "nb", this.neighborhoodId);
    presence.setPlacement(userId, { scene: "nb", nbId: this.neighborhoodId });
    client.send("welcome", { x: b.x, z: b.z, facing: b.facing, house: residence.lot_number, visitor });
    refreshLife(userId);
    log.info("join", { roomId: this.roomId, online: this.state.players.size, visitor });
  }

  /** Vida recalculada (MeuMundoLifeService → applyLife): na rua, o ritmo e o tipo físico. */
  applyLife(sid, life) {
    const s = this.sim.get(sid);
    const p = this.state.players.get(sid);
    if (!s || !p) return;
    s.pace = life.pace;
    p.pace = life.pace;
    if (MeuMundoStorage.BODIES.includes(life.body)) p.body = life.body;
  }

  onLeave(client) {
    const s = this.sim.get(client.sessionId);
    if (s) {
      this.parkCar(client.sessionId, s);
      rememberPos(`${s.userId}|${this.neighborhoodId}`, s.body);
      presence.release(s.userId, this, client.sessionId);
    }
    this.sim.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  /** A presença foi para outra sala: a desta sai na hora (sem esperar o socket). */
  dropSession(sessionId) {
    const s = this.sim.get(sessionId);
    if (s) {
      this.parkCar(sessionId, s);
      rememberPos(`${s.userId}|${this.neighborhoodId}`, s.body);
    }
    this.sim.delete(sessionId);
    this.state.players.delete(sessionId);
  }

  /** Posição confirmada de um usuário nesta sala (validação de proximidade). */
  positionOf(userId) {
    for (const s of this.sim.values()) if (s.userId === userId) return { x: s.body.x, z: s.body.z, driving: !!s.car, car: s.car };
    return null;
  }

  // ── Veículos (mm3d-11 carro; mm3d-14 bike, skate e patins) ───────────────
  ensureVehicles(lotNumber) {
    for (const kind of KIND_NAMES) {
      const id = vehicleId(kind, lotNumber);
      const key = String(id);
      // Guardado numa casa ou levado ao centro (mm3d-17): não aparece na rua.
      if (this.state.cars.has(key) || this.indoors.has(id) || isAway(this.neighborhoodId, id)) continue;
      // Onde ficou da última vez (mig 299), se ainda couber lá (uma casa que
      // mudou de nível pode ter ocupado o lugar); senão, a vaga.
      const v = this.saved.get(id);
      this.saved.delete(id);
      const p = v && carFits(v.x, v.z, v.facing, this.obstacles, kind) ? v : spotFor(kind, lotNumber);
      this.state.cars.set(key, new Car({ lot: lotNumber, kind, x: p.x, z: p.z, facing: p.facing, driver: "" }));
    }
  }

  /** Grava onde o veículo parou (mig 299). Falhar aqui não trava a sala. */
  persistVehicle(id) {
    const c = this.state.cars.get(String(id));
    if (!c) return;
    MeuMundoVehicleStorage.save(pool, this.neighborhoodId, Number(id), {
      x: c.x,
      z: c.z,
      facing: c.facing,
      layout: LAYOUT_VERSION,
    }).catch((err) => log.error("vehicle.persist_fail", { message: err.message }));
  }

  /** Monta `sid` no veículo `id` (quem chama já conferiu dono, distância e ocupação). */
  mount(sid, s, p, id, c) {
    const kind = RIDE_KINDS[c.kind] ? c.kind : "car";
    c.driver = sid;
    s.car = id;
    s.veh = createVehicle(c.x, c.z, c.facing);
    s.drive = IDLE_DRIVE;
    Object.assign(s.body, { x: c.x, z: c.z, vx: 0, vz: 0, facing: c.facing });
    s.intent = { x: 0, z: 0, run: false };
    if (p) Object.assign(p, { car: id, x: c.x, z: c.z, facing: c.facing, move: RIDE_KINDS[kind].move });
  }

  /**
   * Entrando em casa montado (mm3d-15): a bike, o skate ou os patins saem da
   * rua junto com a pessoa (o serviço grava onde ficam dentro da casa). O
   * carro não entra. Devolve { id, kind } ou { error }.
   */
  stowRide(userId) {
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId || !s.car) continue;
      const c = this.state.cars.get(String(s.car));
      if (!c || c.kind === "car" || !RIDE_KINDS[c.kind]) return { error: "car" };
      if (s.veh && Math.hypot(s.veh.vx, s.veh.vz) > CAR.EXIT_MAX_SPEED) return { error: "moving" };
      const id = s.car;
      this.state.cars.delete(String(id));
      this.indoors.add(id);
      s.car = 0;
      s.veh = null;
      s.drive = IDLE_DRIVE;
      const p = this.state.players.get(sid);
      if (p) Object.assign(p, { car: 0, move: 0 });
      return { id, kind: c.kind };
    }
    return { error: "not_riding" };
  }

  /**
   * Indo ao centro montado ou dirigindo (mm3d-17): QUALQUER veículo sai da rua
   * com a pessoa. Grava antes onde ele estava — é para lá que volta se a
   * viagem falhar ou se ela não voltar com ele. Devolve { id, kind } ou { error }.
   */
  sendAway(userId) {
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId || !s.car) continue;
      const c = this.state.cars.get(String(s.car));
      if (!c || !RIDE_KINDS[c.kind]) return { error: "not_riding" };
      if (s.veh && Math.hypot(s.veh.vx, s.veh.vz) > CAR.EXIT_MAX_SPEED) return { error: "moving" };
      const id = s.car;
      const from = { x: c.x, z: c.z, facing: c.facing };
      Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0, vx: 0, vz: 0, w: 0 });
      this.persistVehicle(id);
      this.state.cars.delete(String(id));
      s.car = 0;
      s.veh = null;
      s.drive = IDLE_DRIVE;
      const p = this.state.players.get(sid);
      if (p) Object.assign(p, { car: 0, move: 0 });
      return { id, kind: c.kind, from };
    }
    return { error: "not_riding" };
  }

  /** O veículo saiu de uma casa para a rua, em `at` (o serviço já gravou). */
  releaseRide(id, at) {
    this.indoors.delete(id);
    const key = String(id);
    const c = this.state.cars.get(key);
    if (c) Object.assign(c, { x: at.x, z: at.z, facing: at.facing });
    else this.state.cars.set(key, new Car({ lot: ((id - 1) % 20) + 1, kind: kindOfId(id), x: at.x, z: at.z, facing: at.facing, driver: "" }));
  }

  /** Caixas dos veículos que bloqueiam `sessionId` (menos o dele e os que não bloqueiam parados). */
  carBoxes(sessionId) {
    const out = [];
    this.state.cars.forEach((c) => {
      if (c.driver && c.driver === sessionId) return;
      if (!blocks(c)) return;
      out.push(carBox(c));
    });
    return out;
  }

  /** Quem dirigia sai da sala (queda, troca de sessão): o carro fica onde está. */
  parkCar(sessionId, s) {
    if (!s.car) return;
    const c = this.state.cars.get(String(s.car));
    if (c && c.driver === sessionId) {
      Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0, vx: 0, vz: 0, w: 0 });
      this.persistVehicle(s.car);
    }
    s.car = 0;
    s.veh = null;
    s.drive = IDLE_DRIVE;
  }

  /** Entrada de direção do motorista (acelerador, freio/ré, volante, freio de mão). */
  onDrive(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const d = sanitizeDrive(msg);
    if (!s || !s.car || !d) return;
    // mm3d-22: com o passo do cliente (k), vale no mesmo passo aqui (meuMundoDriveSync.js).
    const k = msg && typeof msg.k === "number" ? Math.floor(msg.k) : -1;
    // mm3d-27: época do cliente (recomeça o passo ao voltar do segundo plano).
    const e = msg && typeof msg.e === "number" ? Math.floor(msg.e) : undefined;
    s.driveAt = Date.now();
    // Aba escondida (mm3d-27): o celular avisa e para de simular — freia já.
    if (msg && msg.z === 1 && s.veh && e !== undefined) {
      s.veh.de = e;
      expireDrive(s.veh, Infinity);
      return;
    }
    if (k >= 0 && s.veh) queueDrive(s.veh, d, k, e);
    else s.drive = d;
  }

  /**
   * Ajuste de dirigibilidade do painel do administrador (a sala do bairro só
   * aceita administradores). Vale para o carro DESTA sessão; fora da faixa é
   * fixado na borda. O cliente usa os mesmos números na previsão.
   */
  onTune(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    if (!s) return;
    const tu = msg && msg.reset ? null : sanitizeTuning(msg);
    s.tune = tu && Object.keys(tu).length ? tu : null;
    client.send("tuned", s.tune || {});
  }

  /** O carro é só do titular da casa; bike, skate e patins, de quem chegar. */
  mayUse(s, p, c, kind) {
    return !(RIDE_KINDS[kind].ownerOnly && (s.visitor || !p.house || p.house !== c.lot));
  }

  /** Para onde "Recuperar" leva o veículo: a vaga da casa dele. */
  homeSpot(kind, c) {
    return spotFor(kind, c.lot);
  }

  onCar(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p || !msg) return;
    const deny = (reason) => client.send("car_denied", { reason });
    if (msg.a === "enter") {
      if (s.car) return;
      // "Usar" (mm3d-14): o id diz qual; sem id, o carro da própria casa.
      const id = Number(msg.id) || p.house;
      const c = id ? this.state.cars.get(String(id)) : null;
      if (!c) return deny("no_car");
      const kind = RIDE_KINDS[c.kind] ? c.kind : "car";
      if (!this.mayUse(s, p, c, kind)) return deny("not_owner");
      if (c.driver) return deny("busy");
      if (Math.hypot(c.x - s.body.x, c.z - s.body.z) > RIDE_KINDS[kind].enter) return deny("far");
      this.mount(client.sessionId, s, p, id, c);
      client.send("moved", { x: c.x, z: c.z, facing: c.facing, car: id });
      return;
    }
    if (msg.a === "recover") {
      // Carro preso (encaixado entre obstáculos): volta para a vaga da casa,
      // só parado, com espera entre um uso e outro e só se a vaga estiver livre.
      if (!s.car || !s.veh) return;
      const c = this.state.cars.get(String(s.car));
      if (!c) return;
      const now = Date.now();
      if (now - s.lastRecoverAt < CAR.RECOVER_COOLDOWN_MS) return deny("cooldown");
      if (Math.hypot(s.veh.vx, s.veh.vz) > CAR.RECOVER_MAX_SPEED) return deny("moving");
      const kind = RIDE_KINDS[c.kind] ? c.kind : "car";
      const spot = this.homeSpot(kind, c, client.sessionId);
      if (!spot || !carFits(spot.x, spot.z, spot.facing, this.obstacles.concat(this.carBoxes(client.sessionId)), kind)) return deny("spot_busy");
      s.lastRecoverAt = now;
      s.veh = createVehicle(spot.x, spot.z, spot.facing);
      Object.assign(s.body, { x: spot.x, z: spot.z, vx: 0, vz: 0, facing: spot.facing });
      Object.assign(c, { x: spot.x, z: spot.z, facing: spot.facing, sp: 0, st: 0, hb: false, sl: 0, vx: 0, vz: 0, w: 0 });
      Object.assign(p, { x: spot.x, z: spot.z, facing: spot.facing });
      client.send("moved", { x: spot.x, z: spot.z, facing: spot.facing, car: s.car });
      return;
    }
    if (msg.a === "exit") {
      if (!s.car) return;
      const c = this.state.cars.get(String(s.car));
      if (!c) return;
      // Só desce com o carro parado (ou quase) — onde o CELULAR o viu parar:
      // a sala termina as mudanças de volante que já chegaram (mm3d-24).
      if (s.veh) {
        const kind = RIDE_KINDS[c.kind] ? c.kind : "car";
        const boxes = this.obstacles.concat(this.carBoxes(client.sessionId));
        const st = settleDriven(s.veh, s.drive, boxes, this.limit, paramsFor(kind, s.tune));
        if (Math.hypot(st.vx, st.vz) > CAR.EXIT_MAX_SPEED) return deny("moving");
        Object.assign(s.body, { x: st.x, z: st.z, facing: st.yaw });
      }
      // O carro para onde está; a pessoa desce num ponto LIVRE ao lado.
      Object.assign(c, { x: s.body.x, z: s.body.z, facing: s.body.facing });
      const blockers = this.obstacles.concat(this.carBoxes(client.sessionId), [carBox(c)]);
      const spot = exitSpots(c, MOTION.RADIUS).find((e) => isSafeSpot(e.x, e.z, resolveCircle, MOTION.RADIUS, blockers));
      if (!spot) return deny("blocked");
      Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0, vx: 0, vz: 0, w: 0 });
      this.persistVehicle(s.car);
      s.car = 0;
      s.veh = null;
      s.drive = IDLE_DRIVE;
      Object.assign(s.body, { x: spot.x, z: spot.z, vx: 0, vz: 0, facing: spot.facing });
      s.intent = { x: 0, z: 0, run: false };
      Object.assign(p, { car: 0, x: spot.x, z: spot.z, facing: spot.facing, move: 0 });
      client.send("moved", { x: spot.x, z: spot.z, facing: spot.facing, car: 0 });
    }
  }

  onDispose() {
    if (roomsByNeighborhood.get(this.neighborhoodId) === this) roomsByNeighborhood.delete(this.neighborhoodId);
    for (const [sid, s] of this.sim) {
      rememberPos(`${s.userId}|${this.neighborhoodId}`, s.body);
      presence.release(s.userId, this, sid);
    }
    log.info("room.dispose", { roomId: this.roomId });
  }

  /** Limite de frequência por cliente (balde de fichas). */
  countMessage(client) {
    return takeToken(client, this.sim.get(client.sessionId));
  }

  onIntent(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const intent = sanitizeIntent(msg);
    if (s && intent) {
      s.intent = intent;
      s.intentAt = Date.now();
    }
  }

  /**
   * Nível confirmado no banco → sala. Só revisão MAIOR que a atual vale (dois
   * pedidos cruzados: vence o último confirmado). Troca as caixas daquela casa
   * e tira de dentro dela quem a casa nova passou a ocupar — só esses, para a
   * frente do lote — avisando o cliente para não ficar preso na parede.
   */
  applyHouseLevel(lotNumber, level, rev) {
    const key = String(lotNumber);
    const cur = this.state.houses.get(key);
    if (cur && rev <= cur.rev) return false;
    const lvl = levelDef(level).level;
    if (cur) {
      cur.level = lvl;
      cur.rev = rev;
    } else {
      this.state.houses.set(key, new HouseLevel({ level: lvl, rev }));
    }
    this.obstacles = this.obstacles.filter((b) => b.lot !== lotNumber).concat(houseBoxes(lotNumber, lvl));
    let moved = 0;
    for (const [sid, s] of this.sim) {
      // Quem está dirigindo está na rua (a casa nova não chega lá).
      if (s.car) continue;
      if (isSafeSpot(s.body.x, s.body.z, resolveCircle, MOTION.RADIUS, this.obstacles)) continue;
      const home = frontOfHouse(lotNumber);
      Object.assign(s.body, { x: home.x, z: home.z, vx: 0, vz: 0, facing: home.rotationY });
      step(s.body, { x: 0, z: 0, run: false }, 0, this.obstacles, LIMIT);
      s.intent = { x: 0, z: 0, run: false };
      const p = this.state.players.get(sid);
      if (p) {
        p.x = s.body.x;
        p.z = s.body.z;
        p.facing = s.body.facing;
        p.move = 0;
      }
      const c = this.clients.find((cl) => cl.sessionId === sid);
      if (c) c.send("moved", { x: s.body.x, z: s.body.z, facing: s.body.facing });
      moved += 1;
    }
    log.info("house_level", { roomId: this.roomId, lot: lotNumber, level: lvl, rev, moved });
    return true;
  }

  tick(dtMs) {
    const dt = Math.min(dtMs / 1000, 0.25);
    const hasCars = this.state.cars.size > 0;
    const now = Date.now();
    for (const [sid, s] of this.sim) {
      const boxes = hasCars ? this.obstacles.concat(this.carBoxes(sid)) : this.obstacles;
      const p = this.state.players.get(sid);
      expireIntent(s, now);
      if (s.car && s.veh) {
        // Dirigindo: a física do carro (passo fixo com acumulador).
        const v = s.veh;
        // mm3d-27: motorista sem notícia (aba escondida) — freia em vez de seguir acelerando.
        if (expireDrive(v, now - (s.driveAt || now))) s.drive = IDLE_DRIVE;
        const c = this.state.cars.get(String(s.car));
        const kind = c && RIDE_KINDS[c.kind] ? c.kind : "car";
        advanceDriven(v, s.drive, dt, boxes, this.limit, paramsFor(kind, s.tune));
        Object.assign(s.body, { x: v.x, z: v.z, vx: v.vx, vz: v.vz, facing: v.yaw });
        if (c) Object.assign(c, { x: v.x, z: v.z, facing: v.yaw, sp: v.u, st: v.steer, hb: v.hb > 0.3, sl: v.slip, vx: v.vx, vz: v.vz, w: v.w });
        if (p) Object.assign(p, { x: v.x, z: v.z, facing: v.yaw, move: RIDE_KINDS[kind].move });
        continue;
      }
      const move = step(s.body, s.intent, dt, boxes, this.limit, paceProfile(s.pace));
      if (!p) continue;
      p.x = s.body.x;
      p.z = s.body.z;
      p.facing = s.body.facing;
      p.move = move;
    }
  }
}

// ═══ SALA DA CASA (mm3d-09) ═══════════════════════════════════════════════
class CasaRoom extends Room {
  async onCreate(options) {
    this.houseId = String(options.houseId || "");
    const house = await MeuMundoStorage.getHouse(pool, this.houseId);
    // O interior é o do nível CONFIRMADO no banco; trocar o nível com alguém
    // dentro é recusado (MeuMundoService.setHouseLevel), então o layout desta
    // sala vale até ela esvaziar.
    this.level = house ? levelDef(house.level).level : 1;
    this.def = interiorFor(this.level);
    this.maxClients = 4; // titular + um convidado, com folga para troca de sessão
    this.patchRate = PATCH_MS;
    this.seatReservationTimeout = 20;
    this.setState(new HouseState());
    this.state.level = this.level;
    this.sim = new Map();
    this.nbId = house ? house.id_neighborhood : "";
    roomsByHouse.set(this.houseId, this);
    // Bike, skate e patins guardados aqui dentro (mig 299). Posição que não
    // vale neste layout (o nível mudou depois) vai para a entrada.
    if (this.def) for (const v of await MeuMundoVehicleStorage.listInHouse(pool, this.houseId)) this.addRide(v.id, v);
    this.onMessage("in", (client, msg) => this.onIntent(client, msg));
    this.onMessage("sit", (client, msg) => this.onSit(client, msg));
    this.onMessage("stand", (client) => this.onStand(client));
    this.onMessage("bed", (client, msg) => this.onBed(client, msg));
    this.onMessage("ride", (client, msg) => this.onRide(client, msg));
    this.onMessage("*", (client) => this.countMessage(client));
    this.setSimulationInterval((dt) => this.tick(dt), SIM_MS);
    this.clock.setInterval(() => {
      for (const s of this.sim.values()) refreshLife(s.userId);
    }, LIFE_REFRESH_MS);
    log.info("house_room.create", { roomId: this.roomId, level: this.level });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const ok = options.houseId === this.houseId && userId && (await AuthStorage.isAdmin(pool, userId));
    const house = ok ? await MeuMundoStorage.getHouse(pool, this.houseId) : null;
    if (!house || !this.def) throw new ServerError(CLOSE.FORBIDDEN, "acesso negado à casa");
    // O nível mudou entre a reserva e a entrada (a sala estava vazia): esta
    // sala tem o layout antigo — o cliente pede de novo.
    if (levelDef(house.level).level !== this.level) throw new ServerError(CLOSE.MOVED, "o nível da casa mudou");
    const isOwner = house.owner_id === userId;
    let isGuest = false;
    if (!isOwner) {
      const visit = await MeuMundoVisitStorage.activeAsGuest(pool, userId);
      isGuest = !!visit && visit.id_house === this.houseId && visit.id_host === house.owner_id;
    }
    if (!isOwner && !isGuest) {
      log.warn("house_join.denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "esta casa precisa de convite");
    }
    // Titular + UM convidado (pessoas, não conexões).
    for (const s of this.sim.values()) {
      if (s.userId === userId) continue;
      if (isGuest && !s.host) throw new ServerError(CLOSE.FORBIDDEN, "a casa já tem um convidado");
    }
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId) continue;
      const old = this.clients.find((c) => c.sessionId === sid);
      this.sim.delete(sid);
      this.state.players.delete(sid);
      if (old) {
        old.send("replaced", {});
        old.leave(CLOSE.REPLACED);
      }
    }
    const e = this.def.entry;
    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    const b = { x: e.x, z: e.z, vx: 0, vz: 0, facing: e.facing, floor: e.floor, y: 0 };
    stepInterior(b, { x: 0, z: 0, run: false }, 0, this.def);
    this.sim.set(client.sessionId, {
      userId,
      host: isOwner,
      body: b,
      seat: null,
      bed: null,
      restKind: null,
      bedPending: false,
      ride: 0,
      pace: 1,
      intent: { x: 0, z: 0, run: false },
      ...freshBucket(),
    });
    this.state.players.set(
      client.sessionId,
      new HousePlayer({
        name: String(options.name || "morador").slice(0, 24),
        body,
        host: isOwner,
        x: b.x,
        z: b.z,
        y: b.y,
        floor: b.floor,
        facing: b.facing,
        move: 0,
        seat: "",
        bed: "",
        pace: 1,
        ride: 0,
      })
    );
    // Entrou montado (mm3d-15): o veículo já foi guardado aqui (addRide).
    const ride = Number(options.ride);
    const r = ride ? this.state.rides.get(String(ride)) : null;
    if (r && !r.rider) {
      Object.assign(r, { x: b.x, z: b.z, y: b.y, floor: b.floor, facing: b.facing });
      this.mountRide(client.sessionId, this.sim.get(client.sessionId), ride, r);
    }
    presence.claim(userId, this, client.sessionId, "house", this.houseId);
    presence.setPlacement(userId, { scene: "house", houseId: this.houseId, nbId: house.id_neighborhood, lot: house.lot_number });
    client.send("welcome", { x: b.x, z: b.z, facing: b.facing, floor: b.floor, host: isOwner });
    // Quem saiu do jogo deitado/dormindo numa cama desta casa volta para ela
    // quando a vida chegar (applyLife).
    refreshLife(userId);
    log.info("house_join", { roomId: this.roomId, online: this.state.players.size, host: isOwner });
  }

  onLeave(client) {
    const s = this.sim.get(client.sessionId);
    if (s) presence.release(s.userId, this, client.sessionId);
    if (s && s.ride) this.dismount(client.sessionId, s, true);
    // Sair (ou cair) libera o assento: ele é só o campo `seat` do jogador.
    this.sim.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  dropSession(sessionId) {
    const s = this.sim.get(sessionId);
    if (s && s.ride) this.dismount(sessionId, s, true);
    this.sim.delete(sessionId);
    this.state.players.delete(sessionId);
  }

  // ── Veículos guardados em casa (mm3d-15) ────────────────────────────────
  /** Põe um veículo aqui dentro (do banco, ou chegando da rua). */
  addRide(id, at) {
    const kind = kindOfId(id);
    if (!kind || kind === "car") return;
    const ok = at && at.floor < this.def.floors.length && isFreeSpot(this.def, at.floor, at.x, at.z, INTERIOR_RIDE_RADIUS);
    const e = this.def.entry;
    const p = ok ? at : { x: e.x, z: e.z, floor: e.floor, facing: e.facing };
    const key = String(id);
    const cur = this.state.rides.get(key);
    const fields = { kind, x: p.x, z: p.z, y: this.def.floors[p.floor].y, floor: p.floor, facing: p.facing, sp: 0 };
    if (cur) Object.assign(cur, fields);
    else this.state.rides.set(key, new HouseRide({ ...fields, rider: "" }));
  }

  mountRide(sid, s, id, r) {
    r.rider = sid;
    s.ride = id;
    s.intent = { x: 0, z: 0, run: false };
    Object.assign(s.body, { x: r.x, z: r.z, vx: 0, vz: 0, facing: r.facing, floor: r.floor });
    stepInterior(s.body, { x: 0, z: 0, run: false }, 0, this.def);
    const p = this.state.players.get(sid);
    if (p) Object.assign(p, { ride: id, x: s.body.x, z: s.body.z, y: s.body.y, floor: s.body.floor, facing: s.body.facing, move: RIDE_KINDS[r.kind].move });
  }

  /** Desce: o veículo fica onde está (gravado). `force` = saída da sala (até na escada). */
  dismount(sid, s, force = false) {
    const r = this.state.rides.get(String(s.ride));
    const id = s.ride;
    s.ride = 0;
    const p = this.state.players.get(sid);
    if (p) Object.assign(p, { ride: 0, move: 0 });
    if (!r) return;
    // Na escada não fica parado: vai para o andar do degrau mais perto.
    const floorY = this.def.floors[s.body.floor].y;
    const onStairs = Math.abs(s.body.y - floorY) > 0.05;
    Object.assign(r, { rider: "", sp: 0, x: s.body.x, z: s.body.z, y: floorY, floor: s.body.floor, facing: s.body.facing });
    if (onStairs || force) this.addRide(id, r);
    MeuMundoVehicleStorage.save(pool, this.nbId, id, {
      x: r.x,
      z: r.z,
      facing: r.facing,
      houseId: this.houseId,
      floor: r.floor,
      layout: LAYOUT_VERSION,
    }).catch((err) => log.error("vehicle.persist_fail", { message: err.message }));
  }

  /** Sair pela porta montado: o veículo sai da casa com a pessoa. Devolve o id (0 = a pé). */
  takeRideOut(userId) {
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId || !s.ride) continue;
      const id = s.ride;
      this.state.rides.delete(String(id));
      s.ride = 0;
      const p = this.state.players.get(sid);
      if (p) Object.assign(p, { ride: 0, move: 0 });
      return id;
    }
    return 0;
  }

  /** "Usar" e "Descer" dentro de casa: `{ a: "on", id }` | `{ a: "off" }`. */
  onRide(client, msg) {
    if (!this.countMessage(client)) return;
    const sid = client.sessionId;
    const s = this.sim.get(sid);
    if (!s || !msg) return;
    const deny = (reason) => client.send("ride", { ok: false, reason });
    if (msg.a === "off") {
      if (!s.ride) return deny("not_riding");
      // Na escada não se desce (o veículo ficaria flutuando entre andares).
      if (Math.abs(s.body.y - this.def.floors[s.body.floor].y) > 0.05) return deny("stairs");
      const id = s.ride;
      this.dismount(sid, s);
      return client.send("ride", { ok: true, id: 0, was: id });
    }
    if (msg.a !== "on") return;
    if (s.ride) return deny("riding");
    if (s.seat || s.bed || s.bedPending) return deny("busy");
    const id = Number(msg.id);
    const r = this.state.rides.get(String(id));
    if (!r) return deny("no_ride");
    if (r.rider) return deny("busy");
    if (r.floor !== s.body.floor || Math.hypot(r.x - s.body.x, r.z - s.body.z) > RIDE_REACH) return deny("far");
    this.mountRide(sid, s, id, r);
    client.send("ride", { ok: true, id, x: s.body.x, z: s.body.z, floor: s.body.floor, facing: s.body.facing });
  }

  onDispose() {
    if (roomsByHouse.get(this.houseId) === this) roomsByHouse.delete(this.houseId);
    for (const [sid, s] of this.sim) presence.release(s.userId, this, sid);
    log.info("house_room.dispose", { roomId: this.roomId });
  }

  countMessage(client) {
    return takeToken(client, this.sim.get(client.sessionId));
  }

  /** Posição confirmada (validação da saída). */
  positionOf(userId) {
    for (const s of this.sim.values()) if (s.userId === userId) return { x: s.body.x, z: s.body.z, floor: s.body.floor, ride: s.ride };
    return null;
  }

  /** Pessoas dentro (troca de nível bloqueada enquanto houver alguém). */
  occupants() {
    return new Set([...this.sim.values()].map((s) => s.userId)).size;
  }

  onIntent(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const intent = sanitizeIntent(msg);
    if (s && intent) {
      s.intent = intent;
      s.intentAt = Date.now();
    }
  }

  /**
   * Sentar: o assento existe neste layout, está no mesmo andar, perto, e
   * ninguém o ocupa. Duas pessoas pedindo o mesmo assento: a primeira
   * mensagem processada ganha (o laço de mensagens é único) e a outra recebe
   * a recusa.
   */
  onSit(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const id = msg && typeof msg.seat === "string" ? msg.seat : "";
    const seat = this.def.seats.find((x) => x.id === id);
    const deny = (reason) => client.send("seat", { ok: false, seat: id, reason });
    if (!s || !seat) return deny("seat");
    if (s.ride) return deny("riding");
    if (s.seat) return deny("seated");
    if (s.bed || s.bedPending) return deny("in_bed");
    if (seat.floor !== s.body.floor || Math.hypot(seat.x - s.body.x, seat.z - s.body.z) > SEAT_REACH) return deny("far");
    for (const o of this.sim.values()) if (o.seat === seat.id) return deny("taken");
    s.seat = seat.id;
    s.intent = { x: 0, z: 0, run: false };
    Object.assign(s.body, { x: seat.x, z: seat.z, vx: 0, vz: 0, facing: seat.facing });
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.seat = seat.id;
      p.x = seat.x;
      p.z = seat.z;
      p.facing = seat.facing;
      p.move = 3;
    }
    client.send("seat", { ok: true, seat: seat.id });
  }

  onStand(client) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    if (!s) return;
    if (s.bed) {
      if (s.bedPending) return;
      this.leaveBed(client.sessionId, s);
      MeuMundoLifeService.getUp(s.userId).catch((err) => log.warn("life.getup_fail", { message: err.message }));
      return;
    }
    if (!s.seat) return;
    this.standUp(client.sessionId, s);
  }

  /**
   * Deitar ou dormir (mm3d-13): `{ bed, a: "lie" | "sleep", hours }`. Fora
   * da cama: a cama existe neste layout, está no mesmo andar, perto e livre.
   * Já deitado: troca deitado ↔ dormindo na mesma cama. A cama é RESERVADA
   * antes de gravar a vida (duas pessoas pedindo a mesma: a primeira mensagem
   * ganha); se a vida recusar (estimulante, internado…), quem acabou de
   * deitar levanta e quem já estava deitado continua.
   */
  async onBed(client, msg) {
    if (!this.countMessage(client)) return;
    const sid = client.sessionId;
    const s = this.sim.get(sid);
    const kind = msg && msg.a === "sleep" ? "sleeping" : "lying";
    const want = s && s.bed ? s.bed : msg && typeof msg.bed === "string" ? msg.bed : "";
    const bed = this.def.beds.find((x) => x.id === want);
    const deny = (reason) => client.send("bed", { ok: false, bed: want, reason });
    if (!s || !bed) return deny("bed");
    if (s.ride) return deny("riding");
    if (s.bedPending) return deny("busy");
    if (s.seat) return deny("seated");
    const wasIn = !!s.bed;
    if (!wasIn) {
      if (bed.floor !== s.body.floor || Math.hypot(bed.x - s.body.x, bed.z - s.body.z) > BED_REACH) return deny("far");
      for (const o of this.sim.values()) if (o.bed === bed.id) return deny("taken");
      this.putInBed(sid, s, bed, "lying");
    }
    const hours = kind === "sleeping" ? Number(msg && msg.hours) || 8 : null;
    s.bedPending = true;
    let out;
    try {
      out = await MeuMundoLifeService.rest(s.userId, kind, hours, { houseId: this.houseId, bedId: bed.id });
    } catch (err) {
      log.error("life.rest_fail", { message: err.message });
      out = { error: "falha", code: "error" };
    }
    s.bedPending = false;
    if (!this.sim.has(sid)) return;
    if (out && out.error) {
      if (!wasIn && s.bed === bed.id) this.leaveBed(sid, s);
      return deny(out.code || "life");
    }
    if (s.bed === bed.id) this.putInBed(sid, s, bed, kind);
    client.send("bed", { ok: true, bed: bed.id, a: kind === "sleeping" ? "sleep" : "lie" });
  }

  putInBed(sid, s, bed, kind) {
    s.bed = bed.id;
    s.restKind = kind;
    s.intent = { x: 0, z: 0, run: false };
    Object.assign(s.body, { x: bed.x, z: bed.z, vx: 0, vz: 0, facing: bed.facing, floor: bed.floor });
    const p = this.state.players.get(sid);
    if (p) Object.assign(p, { bed: bed.id, x: bed.x, z: bed.z, facing: bed.facing, floor: bed.floor, move: kind === "sleeping" ? 5 : 4 });
  }

  leaveBed(sid, s) {
    const bed = this.def.beds.find((x) => x.id === s.bed);
    s.bed = null;
    s.restKind = null;
    // Uma leitura da vida que chegue antes de "levantou" ser gravado não o
    // devolve à cama.
    s.leftBedAt = Date.now();
    if (bed) {
      Object.assign(s.body, { x: bed.stand.x, z: bed.stand.z, vx: 0, vz: 0, floor: bed.floor });
      stepInterior(s.body, { x: 0, z: 0, run: false }, 0, this.def);
    }
    const p = this.state.players.get(sid);
    if (p) Object.assign(p, { bed: "", move: 0, x: s.body.x, z: s.body.z, y: s.body.y, floor: s.body.floor });
    const c = this.clients.find((cl) => cl.sessionId === sid);
    if (c) c.send("stood", { x: s.body.x, z: s.body.z, floor: s.body.floor, facing: s.body.facing });
  }

  /**
   * Vida recalculada (MeuMundoLifeService → applyLife): ritmo; volta para a
   * cama desta casa quem está deitado/dormindo nela; levanta quem a vida
   * tirou da cama (o sono acabou, internação, morte).
   */
  applyLife(sid, life) {
    const s = this.sim.get(sid);
    const p = this.state.players.get(sid);
    if (!s || !p) return;
    s.pace = life.pace;
    p.pace = life.pace;
    if (MeuMundoStorage.BODIES.includes(life.body)) p.body = life.body;
    if (s.bedPending) return;
    const resting = life.status === "alive" && (life.activity === "lying" || life.activity === "sleeping");
    const here = resting && life.bed && life.bed.houseId === this.houseId ? this.def.beds.find((b) => b.id === life.bed.bedId) : null;
    if (s.bed && (!here || here.id !== s.bed)) return this.leaveBed(sid, s);
    if (!here) return;
    if (s.bed) {
      if (s.restKind !== life.activity) this.putInBed(sid, s, here, life.activity);
      return;
    }
    if (s.seat || Date.now() - (s.leftBedAt || 0) < 5000) return;
    for (const [osid, o] of this.sim) if (osid !== sid && o.bed === here.id) return;
    this.putInBed(sid, s, here, life.activity);
    const c = this.clients.find((cl) => cl.sessionId === sid);
    if (c) c.send("bed", { ok: true, bed: here.id, a: life.activity === "sleeping" ? "sleep" : "lie", restored: true });
  }

  standUp(sid, s) {
    const seat = this.def.seats.find((x) => x.id === s.seat);
    s.seat = null;
    if (seat) {
      // O ponto de levantar foi escolhido livre e alcançável na montagem da
      // planta; se outra pessoa estiver em cima dele, levanta mesmo assim
      // (pessoas não colidem entre si).
      Object.assign(s.body, { x: seat.stand.x, z: seat.stand.z, vx: 0, vz: 0, floor: seat.floor });
      stepInterior(s.body, { x: 0, z: 0, run: false }, 0, this.def);
    }
    const p = this.state.players.get(sid);
    if (p) {
      p.seat = "";
      p.move = 0;
      p.x = s.body.x;
      p.z = s.body.z;
      p.y = s.body.y;
      p.floor = s.body.floor;
    }
    const c = this.clients.find((cl) => cl.sessionId === sid);
    if (c) c.send("stood", { x: s.body.x, z: s.body.z, floor: s.body.floor, facing: s.body.facing });
  }

  tick(dtMs) {
    const dt = Math.min(dtMs / 1000, 0.25);
    const now = Date.now();
    for (const [sid, s] of this.sim) {
      if (s.seat || s.bed) continue;
      expireIntent(s, now);
      const move = stepInterior(s.body, s.intent, dt, this.def, paceSpeeds(s.pace));
      const p = this.state.players.get(sid);
      if (!p) continue;
      p.x = s.body.x;
      p.z = s.body.z;
      p.y = s.body.y;
      p.floor = s.body.floor;
      p.facing = s.body.facing;
      p.move = move;
      // Montado (mm3d-15): mesma regra de andar (a casa é pequena); a pose é
      // a da modalidade e o veículo acompanha.
      const r = s.ride ? this.state.rides.get(String(s.ride)) : null;
      if (r) {
        p.move = RIDE_KINDS[r.kind].move;
        Object.assign(r, { x: s.body.x, z: s.body.z, y: s.body.y, floor: s.body.floor, facing: s.body.facing, sp: Math.hypot(s.body.vx, s.body.vz) });
      }
    }
  }
}

// ═══ SALA DO CENTRO (mm3d-17) ════════════════════════════════════════════
// Uma planta só (meuMundoCenter.js) e quantas salas forem precisas, cada uma
// com até 20 pessoas de QUALQUER bairro. Quem escolhe a sala é o matchmaker
// (`filterBy mapVersion` + a mais cheia com vaga primeiro): a conferência da
// vaga e a reserva acontecem no mesmo passo síncrono do Colyseus, então duas
// entradas ao mesmo tempo não pegam a mesma última vaga e a sala nunca passa
// de 20 (conectados + reservas + vagas guardadas).
//
// Quem cai sem sair (aba fechada, rede) tem a vaga GUARDADA por HOLD_MS: a
// capacidade aberta para os outros encolhe (maxClients = 20 − guardadas) e a
// volta dele entra por `reserveHeldSeat`, que devolve a vaga e reserva no
// mesmo passo. Depois do prazo a vaga se solta e os veículos dele voltam
// para o bairro de onde vieram.
//
// Veículos chegam com o dono (não existem carros do centro). Cada um ganha um
// id LOCAL da sala (deslocamento da modalidade + vaga da pessoa, 1–80): ids
// de bairros diferentes não colidem, e só o dono usa (mayUse).
const CENTER_ROOM = "centro";
const timing = { holdMs: Number(process.env.MM_CENTER_HOLD_MS) || 20000, emptyMs: Number(process.env.MM_CENTER_EMPTY_MS) || 60000 };
const centerRooms = new Map(); // roomId → CentroRoom

class CentroRoom extends BairroRoom {
  async onCreate(options) {
    this.mapVersion = Number(options.mapVersion) || CENTER_VERSION;
    this.cap = CENTER_CAPACITY;
    this.maxClients = this.cap;
    this.patchRate = PATCH_MS;
    this.seatReservationTimeout = 20;
    // Sala vazia espera emptyMs antes de fechar (reconexão, quem está chegando).
    this.autoDispose = false;
    this.setState(new State());
    this.sim = new Map();
    this.obstacles = CENTER_OBSTACLES.map((b) => ({ ...b }));
    this.limit = CENTER_LIMIT;
    this.indoors = new Set();
    this.saved = new Map();
    /** userId → { slot, x, z, facing, until } — vaga guardada de quem caiu. */
    this.holds = new Map();
    /** userId → hold devolvido por reserveHeldSeat, consumido no onJoin. */
    this.returning = new Map();
    /** id local do veículo → { nbId, id, userId } (de onde ele veio). */
    this.origin = new Map();
    this.emptyTimer = null;
    centerRooms.set(this.roomId, this);
    this.startLoop();
    this.armEmpty();
    log.info("center.create", { roomId: this.roomId, version: this.mapVersion });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const ok = Number(options.mapVersion) === this.mapVersion && userId && (await AuthStorage.isAdmin(pool, userId));
    // Só entra quem o serviço mandou para o centro (o destino autorizado é gravado antes de reservar).
    const pl = ok ? presence.getPlacement(userId) : null;
    if (!ok || !pl || pl.scene !== "center") {
      log.warn("center.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao centro");
    }
    this.cancelEmpty();
    // Uma sessão por usuário: a nova substitui a antiga (mesma vaga).
    let slot = 0;
    let start = null;
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId) continue;
      slot = s.slot;
      start = { x: s.body.x, z: s.body.z, facing: s.body.facing };
      const old = this.clients.find((c) => c.sessionId === sid);
      this.sim.delete(sid);
      this.state.players.delete(sid);
      if (old) {
        old.send("replaced", {});
        old.leave(CLOSE.REPLACED);
      }
    }
    // Voltando dentro do prazo: a mesma vaga, onde estava.
    const back = this.returning.get(userId) || this.holds.get(userId);
    this.returning.delete(userId);
    if (this.holds.delete(userId)) this.updateCapacity();
    if (back) {
      slot = back.slot;
      start = { x: back.x, z: back.z, facing: back.facing };
    }
    if (!slot) slot = this.freeSlot();
    if (start && !isCenterSafe(start.x, start.z, resolveCircle, MOTION.RADIUS, this.obstacles)) start = null;
    if (!start) start = { ...CENTER_ARRIVAL };

    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    const b = { x: start.x, z: start.z, vx: 0, vz: 0, facing: start.facing };
    step(b, { x: 0, z: 0, run: false }, 0, this.obstacles, this.limit);
    this.sim.set(client.sessionId, {
      userId,
      visitor: false,
      slot,
      body: b,
      intent: { x: 0, z: 0, run: false },
      ...freshBucket(),
      car: 0,
      veh: null,
      drive: IDLE_DRIVE,
      tune: null,
      lastRecoverAt: 0,
      pace: 1,
    });
    // `house` = vaga da pessoa NESTA sala (é o que diz de quem é cada veículo).
    this.state.players.set(
      client.sessionId,
      new Player({ name: String(options.name || "morador").slice(0, 24), house: slot, body, x: b.x, z: b.z, facing: b.facing, move: 0, car: 0, pace: 1 })
    );
    // Chegou montado ou dirigindo: o veículo que saiu do bairro com ela.
    const v = options.vehicle;
    if (v && v.nbId && v.id && claimAway(v.nbId, Number(v.id), userId, this.roomId)) this.arriveWith(client.sessionId, slot, v);
    presence.claim(userId, this, client.sessionId, "center", this.roomId);
    presence.setPlacement(userId, { scene: "center", roomId: this.roomId, from: pl.from || null });
    client.send("welcome", { x: b.x, z: b.z, facing: b.facing, house: slot, visitor: false });
    refreshLife(userId);
    this.syncLockSoon();
    log.info("center.join", { roomId: this.roomId, online: this.state.players.size, slot, held: !!back });
  }

  /** Menor vaga (1–20) sem ninguém e sem guarda. */
  freeSlot() {
    const used = new Set();
    for (const s of this.sim.values()) used.add(s.slot);
    for (const h of this.holds.values()) used.add(h.slot);
    for (const h of this.returning.values()) used.add(h.slot);
    for (let i = 1; i <= this.cap; i++) if (!used.has(i)) return i;
    return this.cap; // inalcançável: maxClients segura antes
  }

  /** Põe o veículo que veio do bairro numa vaga de chegada livre, com a pessoa nele. */
  arriveWith(sid, slot, v) {
    const kind = RIDE_KINDS[v.kind] ? v.kind : kindOfId(Number(v.id));
    const id = RIDE_KINDS[kind].offset + slot;
    const blockers = this.obstacles.concat(this.carBoxes(sid));
    const spot = CENTER_ARRIVAL_SPOTS.find((p) => carFits(p.x, p.z, p.facing, blockers, kind)) || CENTER_ARRIVAL_SPOTS[0];
    const c = new Car({ lot: slot, kind, x: spot.x, z: spot.z, facing: spot.facing, driver: "" });
    this.state.cars.set(String(id), c);
    this.origin.set(id, { nbId: v.nbId, id: Number(v.id), userId: this.sim.get(sid).userId });
    this.mount(sid, this.sim.get(sid), this.state.players.get(sid), id, c);
  }

  /** No centro, todo veículo é só de quem trouxe (a vaga da pessoa). */
  mayUse(s, p, c) {
    return !!p.house && p.house === c.lot;
  }

  /** "Recuperar" no centro: a primeira vaga de chegada livre. */
  homeSpot(kind, c, sid) {
    const blockers = this.obstacles.concat(this.carBoxes(sid));
    return CENTER_ARRIVAL_SPOTS.find((p) => carFits(p.x, p.z, p.facing, blockers, kind)) || null;
  }

  /** Posição dos veículos do centro não vai ao banco (o do bairro guarda a de lá). */
  persistVehicle() {}

  updateCapacity() {
    this.maxClients = Math.max(0, this.cap - this.holds.size);
    this.syncLockSoon();
  }

  /**
   * A trava que o matchmaker enxerga precisa acompanhar a capacidade: o
   * Colyseus destrava sozinho quando um cliente sai (sem conferir as vagas
   * guardadas), e a sala cheia por guarda ficava listada como aberta — quem
   * chegava insistia nela. Reavaliado DEPOIS da contabilidade dele. (O limite
   * de 20 não depende disto: a reserva confere a vaga de qualquer jeito.)
   */
  syncLockSoon() {
    setTimeout(() => {
      if (this.closed) return;
      if (this.hasReachedMaxClients()) {
        this._listing.locked = true;
        void this.lock();
      } else if (this._lockedExplicitly) void this.unlock();
    }, 0);
  }

  /** Veículos que vieram com `userId` voltam ao bairro de origem, na posição gravada na saída. */
  sendVehiclesHome(userId) {
    for (const [id, o] of [...this.origin]) {
      if (o.userId !== userId) continue;
      this.state.cars.delete(String(id));
      this.origin.delete(id);
      returnAway(o.nbId, o.id, null);
    }
  }

  /**
   * Tira o veículo em que `userId` está (voltando para casa com ele). Devolve
   * { nbId, id, kind } de origem ou { error }.
   */
  takeDriven(userId) {
    for (const [sid, s] of this.sim) {
      if (s.userId !== userId || !s.car) continue;
      const o = this.origin.get(s.car);
      const c = this.state.cars.get(String(s.car));
      if (!o || !c) return { error: "not_riding" };
      if (s.veh && Math.hypot(s.veh.vx, s.veh.vz) > CAR.EXIT_MAX_SPEED) return { error: "moving" };
      this.state.cars.delete(String(s.car));
      this.origin.delete(s.car);
      s.car = 0;
      s.veh = null;
      s.drive = IDLE_DRIVE;
      return { nbId: o.nbId, id: o.id, kind: c.kind };
    }
    return { error: "not_riding" };
  }

  onLeave(client, code) {
    const s = this.sim.get(client.sessionId);
    this.sim.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (s) {
      this.parkCar(client.sessionId, s);
      presence.release(s.userId, this, client.sessionId);
      if (code === CLOSE_CONSENTED) {
        // Saiu do jogo pelo menu: a próxima entrada é em casa (não no centro).
        this.sendVehiclesHome(s.userId);
        const pl = presence.getPlacement(s.userId);
        if (pl && pl.scene === "center" && pl.roomId === this.roomId) presence.setPlacement(s.userId, { scene: "left" });
      } else this.hold(s);
    }
    this.syncLockSoon();
    this.armEmpty();
  }

  /** Caiu sem sair: guarda a vaga (e o que ele trouxe) por holdMs. */
  hold(s) {
    const until = Date.now() + timing.holdMs;
    this.holds.set(s.userId, { slot: s.slot, x: s.body.x, z: s.body.z, facing: s.body.facing, until });
    this.updateCapacity();
    this.clock.setTimeout(() => {
      const h = this.holds.get(s.userId);
      if (!h || h.until !== until) return;
      this.holds.delete(s.userId);
      this.updateCapacity();
      this.sendVehiclesHome(s.userId);
      log.info("center.hold_expired", { roomId: this.roomId });
      this.armEmpty();
    }, timing.holdMs);
  }

  /** A presença foi para outra sala (voltou para casa, outra aba): sai sem guardar vaga. */
  dropSession(sessionId) {
    const s = this.sim.get(sessionId);
    this.sim.delete(sessionId);
    this.state.players.delete(sessionId);
    if (s) {
      this.parkCar(sessionId, s);
      this.sendVehiclesHome(s.userId);
    }
    this.syncLockSoon();
    this.armEmpty();
  }

  cancelEmpty() {
    if (this.emptyTimer) this.emptyTimer.clear();
    this.emptyTimer = null;
  }

  /** Vazia (sem ninguém, sem reserva, sem vaga guardada) por emptyMs: fecha. */
  armEmpty() {
    const idle = () => this.clients.length === 0 && this.sim.size === 0 && this.holds.size === 0 && Object.keys(this._reservedSeats || {}).length === 0;
    if (!idle() || this.emptyTimer) return;
    this.emptyTimer = this.clock.setTimeout(() => {
      this.emptyTimer = null;
      if (idle()) this.disconnect();
      else this.armEmpty();
    }, timing.emptyMs);
  }

  onDispose() {
    this.closed = true;
    if (centerRooms.get(this.roomId) === this) centerRooms.delete(this.roomId);
    for (const [sid, s] of this.sim) presence.release(s.userId, this, sid);
    for (const o of this.origin.values()) returnAway(o.nbId, o.id, null);
    this.origin.clear();
    log.info("center.dispose", { roomId: this.roomId });
  }

  positionOf(userId) {
    for (const s of this.sim.values()) if (s.userId === userId) return { x: s.body.x, z: s.body.z, driving: !!s.car, car: s.car };
    return null;
  }

  applyHouseLevel() {
    return false;
  }
}

// ── Veículos fora do bairro (no centro, ou a caminho dele) ──────────────────
// Processo único: a marca vive em memória. Reiniciar o servidor zera as salas
// do centro e a marca juntas — o veículo fica onde o banco diz (a posição de
// saída, gravada no sendAway).
const away = new Map(); // `${nbId}|${id}` → { userId, from, at, roomId|null }
const awayKey = (nbId, id) => `${nbId}|${id}`;
function isAway(nbId, id) {
  return away.has(awayKey(nbId, id));
}

/** Tira da rua do bairro o veículo em que `userId` está e o marca como fora. */
function sendVehicleAway(neighborhoodId, userId) {
  const room = roomsByNeighborhood.get(neighborhoodId);
  if (!room) return { error: "not_riding" };
  const r = room.sendAway(userId);
  if (r.error) return r;
  away.set(awayKey(neighborhoodId, r.id), { userId, kind: r.kind, from: r.from, at: Date.now(), roomId: null });
  return r;
}

/** A sala do centro assume o veículo (só o dono, só se ainda estiver a caminho). */
function claimAway(nbId, id, userId, roomId) {
  const a = away.get(awayKey(nbId, id));
  if (!a || a.userId !== userId || a.roomId) return false;
  a.roomId = roomId;
  return true;
}

/**
 * O veículo volta para o bairro: em `at` (já gravado pelo serviço) ou, sem
 * `at`, onde estava quando saiu. Se a rua estiver aberta, aparece na hora.
 */
function returnAway(nbId, id, at) {
  const key = awayKey(nbId, id);
  const a = away.get(key);
  away.delete(key);
  const room = roomsByNeighborhood.get(nbId);
  const where = at || (a && a.from);
  if (room && where) room.releaseRide(id, where);
}

/** Veículo que saiu e nunca chegou (a reserva do centro venceu): volta. */
function sweepAway(maxMs = 45000) {
  const now = Date.now();
  for (const [key, a] of [...away]) {
    if (a.roomId || now - a.at < maxMs) continue;
    const [nbId, id] = key.split("|");
    returnAway(nbId, Number(id), null);
    log.info("vehicle.away_returned", {});
  }
}

let ready = null;
let transport = null;

function init(httpServer) {
  if (ready) return ready;
  // Socket de upgrade sem ouvinte de erro derruba o PROCESSO num ECONNRESET
  // (o navegador fecha a conexão no meio da troca de ambiente). O ouvinte
  // entra ANTES do transporte, para valer desde o primeiro byte.
  httpServer.on("upgrade", (req, socket) => {
    if (typeof req.url === "string" && req.url.startsWith(WS_PREFIX)) {
      socket.on("error", (err) => log.warn("ws.socket_error", { code: err && err.code }));
    }
  });
  transport = new WebSocketTransport({ noServer: true, pingInterval: 5000, pingMaxRetries: 3 });
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false });
  gameServer.define(ROOM_NAME, BairroRoom).filterBy(["neighborhoodId"]);
  gameServer.define(HOUSE_ROOM, CasaRoom).filterBy(["houseId"]);
  // Centro: salas da MESMA versão da planta; a mais cheia com vaga primeiro (encontros).
  gameServer.define(CENTER_ROOM, CentroRoom).filterBy(["mapVersion"]).sortBy({ clients: -1 });
  // Jetpack em grupo (mm3d-21): até 4 do mesmo centro.
  jetpack.define(gameServer);
  transport.attachToServer(httpServer, {
    filter: (req) => typeof req.url === "string" && req.url.startsWith(WS_PREFIX),
  });
  ready = matchMaker
    .accept()
    .then(() => log.info("ready", { prefix: WS_PREFIX }))
    .catch((err) => {
      log.error("init_fail", { message: err.message });
      throw err;
    });
  return ready;
}

/**
 * Reserva o lugar do usuário na sala do bairro indicado. Quem chama já
 * validou a sessão, o papel e o direito de estar ali (morador ou visita).
 */
async function reserveSeat({ neighborhoodId, userId, name, body, arrivalLot = null, ride = 0 }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  await ready;
  return matchMaker.joinOrCreate(ROOM_NAME, { neighborhoodId, userId, name, body, arrivalLot, ride });
}

/** Reserva o lugar na sala de uma casa (titular ou convidado já conferidos). `ride` = entra montado. */
async function reserveHouseSeat({ houseId, userId, name, body, ride = 0 }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  await ready;
  return matchMaker.joinOrCreate(HOUSE_ROOM, { houseId, userId, name, body, ride });
}

/**
 * Reserva o lugar no centro (mm3d-17). Quem chama já gravou o destino
 * autorizado (placement "center") e conferiu origem e papel. `roomId` = a
 * pessoa estava numa sala do centro há pouco: tenta a MESMA (vaga guardada,
 * ou a sala em que ela ainda está conectada); sem vaga lá, qualquer outra.
 */
async function reserveCenterSeat({ userId, name, body, vehicle = null, roomId = null }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  await ready;
  const options = { mapVersion: CENTER_VERSION, userId, name, body, vehicle };
  if (roomId) {
    const held = await reserveHeldSeat(roomId, userId, options);
    if (held) return held;
  }
  // A sala escolhida pode encher entre a busca e a reserva: o matchmaker tenta
  // de novo (5×) e, sem vaga, cria outra. Mais algumas voltas para rajadas.
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(CENTER_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation/i.test(String(err && (err.name + err.message)))) throw err;
    }
  }
  throw last;
}

/**
 * Volta para a mesma sala: devolve a vaga guardada e reserva NO MESMO PASSO
 * síncrono (ninguém pega a vaga no meio). Sem guarda, só se a pessoa ainda
 * estiver conectada lá (troca de aba) e houver vaga. null = usar outra sala.
 */
function reserveHeldSeat(roomId, userId, options) {
  const room = centerRooms.get(roomId);
  if (!room) return null;
  const hold = room.holds.get(userId);
  const there = [...room.sim.values()].some((s) => s.userId === userId);
  if (!hold && !there) return null;
  if (hold) {
    room.holds.delete(userId);
    room.returning.set(userId, hold);
    room.updateCapacity();
    // Reserva que não for usada: a vaga se solta e os veículos voltam.
    room.clock.setTimeout(() => {
      if (room.returning.get(userId) !== hold) return;
      room.returning.delete(userId);
      if (![...room.sim.values()].some((s) => s.userId === userId)) room.sendVehiclesHome(userId);
      room.armEmpty();
    }, (room.seatReservationTimeout + 5) * 1000);
  } else if (room.hasReachedMaxClients()) return null;
  return matchMaker.reserveSeatFor(room._listing, options).catch(() => null);
}

/** A sala do centro ainda guarda a vaga desta pessoa (caiu há pouco)? */
function hasCenterHold(roomId, userId) {
  const room = centerRooms.get(roomId);
  return !!room && (room.holds.has(userId) || room.returning.has(userId));
}

/** A pessoa saiu do centro por uma transição (voltar para casa): sai sem guardar vaga. */
function leaveCenter(roomId, userId) {
  const room = centerRooms.get(roomId);
  if (!room) return;
  for (const [sid, s] of [...room.sim]) if (s.userId === userId) room.dropSession(sid);
  // Tinha caído (vaga guardada) e voltou para casa: a vaga se solta agora, não
  // no fim do prazo — senão a sala fica cheia por uma guarda que ninguém vai
  // usar e quem chega cai em outra sala (mm3d-19).
  const held = room.holds.delete(userId);
  const back = room.returning.delete(userId);
  if (held || back) {
    room.updateCapacity();
    room.sendVehiclesHome(userId);
    room.armEmpty();
  }
}

/** Tira do centro o veículo em que `userId` está (voltando para casa com ele). */
function takeDrivenFromCenter(roomId, userId) {
  const room = centerRooms.get(roomId);
  return room ? room.takeDriven(userId) : { error: "not_riding" };
}

// ── Veículos entre a rua e as casas (mm3d-15; o serviço grava no banco) ─────
/** Tira da rua a bike/skate/patins em que `userId` está (entrando em casa). */
function stowRide(neighborhoodId, userId) {
  const room = roomsByNeighborhood.get(neighborhoodId);
  return room ? room.stowRide(userId) : { error: "not_riding" };
}

/** Põe o veículo na sala viva da casa (se houver alguém lá dentro). */
function addRideToHouse(houseId, id, at) {
  const room = roomsByHouse.get(houseId);
  if (room) room.addRide(id, at);
}

/** Tira da casa o veículo em que `userId` está montado (saindo pela porta). */
function takeRideOut(houseId, userId) {
  const room = roomsByHouse.get(houseId);
  return room ? room.takeRideOut(userId) : 0;
}

/** Devolve o veículo à rua viva do bairro, em `at`. */
function releaseRide(neighborhoodId, id, at) {
  const room = roomsByNeighborhood.get(neighborhoodId);
  if (room) room.releaseRide(id, at);
}

/** Leva a troca de nível à sala viva do bairro (se houver alguém online). */
function applyHouseLevel(neighborhoodId, lotNumber, level, rev) {
  const room = roomsByNeighborhood.get(neighborhoodId);
  return room ? room.applyHouseLevel(lotNumber, level, rev) : false;
}

/** Quantas pessoas estão dentro da casa agora. */
function houseOccupants(houseId) {
  const room = roomsByHouse.get(houseId);
  return room ? room.occupants() : 0;
}

/**
 * Quem saiu pela porta deixa de contar como ocupante NA HORA: o socket da
 * casa só fecha depois que o cliente entra na rua (~1 s), e nesse intervalo
 * "trocar nível" responderia "peça para todos saírem" a quem acabou de sair.
 */
function dropFromHouse(houseId, userId) {
  const room = roomsByHouse.get(houseId);
  if (!room) return;
  for (const [sid, s] of [...room.sim]) if (s.userId === userId) room.dropSession(sid);
  // Vazia, ela não pode ser reaproveitada: o nível pode mudar antes de o
  // socket fechar, e a próxima entrada cairia no layout antigo. Trancada e
  // fora do mapa, quem entrar ganha uma sala nova; esta some ao esvaziar.
  if (room.sim.size === 0) {
    roomsByHouse.delete(houseId);
    Promise.resolve(room.lock()).catch(() => {});
  }
}

/** A vida do usuário mudou (MeuMundoLifeService): leva à sala em que ele está e avisa o cliente. */
function applyLife(userId, life) {
  const p = presence.get(userId);
  if (!p || !p.room.applyLife) return false;
  p.room.applyLife(p.sessionId, life);
  presence.send(userId, "life", { pace: life.pace, status: life.status, activity: life.activity, body: life.body });
  return true;
}

/** Posição do usuário segundo a sala em que ele está (null = não está). */
function positionIn(scene, id, userId) {
  const room = scene === "nb" ? roomsByNeighborhood.get(id) : scene === "center" ? centerRooms.get(id) : roomsByHouse.get(id);
  return room ? room.positionOf(userId) : null;
}

async function status() {
  if (!ready) return { available: false };
  await ready;
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  const houses = await matchMaker.query({ name: HOUSE_ROOM });
  const centers = await matchMaker.query({ name: CENTER_ROOM });
  return {
    available: true,
    process: "single",
    rooms: rooms.length,
    clients: rooms.reduce((n, r) => n + (r.clients || 0), 0),
    houseRooms: houses.length,
    houseClients: houses.reduce((n, r) => n + (r.clients || 0), 0),
    centerRooms: centers.length,
    centerClients: centers.reduce((n, r) => n + (r.clients || 0), 0),
    ...(await jetpack.jetpackStatus()),
  };
}

// Só para a suíte e2e (test/meu-mundo.e2e.js): alcança as salas vivas.
const _roomFor = (neighborhoodId) => roomsByNeighborhood.get(neighborhoodId) || null;
const _houseRoomFor = (houseId) => roomsByHouse.get(houseId) || null;
const _centerRooms = () => [...centerRooms.values()];
const _centerTiming = timing;

module.exports = {
  init,
  reserveSeat,
  reserveHouseSeat,
  reserveCenterSeat,
  hasCenterHold,
  leaveCenter,
  takeDrivenFromCenter,
  sendVehicleAway,
  returnAway,
  sweepAway,
  isAway,
  status,
  applyHouseLevel,
  houseOccupants,
  dropFromHouse,
  positionIn,
  applyLife,
  stowRide,
  addRideToHouse,
  takeRideOut,
  releaseRide,
  isFreeSpot,
  WS_PREFIX,
  BairroRoom,
  CasaRoom,
  CentroRoom,
  CLOSE,
  _roomFor,
  _houseRoomFor,
  _centerRooms,
  _centerTiming,
};
