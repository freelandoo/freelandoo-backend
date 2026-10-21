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
const presence = require("./meuMundoPresence");
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
const { CAR, RIDE_KINDS, KIND_NAMES, vehicleId, spotFor, carBox, blocks, carFits, exitSpots } = require("../utils/meuMundoCars");
const {
  IDLE: IDLE_DRIVE,
  paramsFor,
  sanitizeDrive,
  sanitizeTuning,
  createVehicle,
  advanceVehicle,
} = require("../utils/meuMundoVehicle");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.realtime");

const WS_PREFIX = "/mm-ws/";
const ROOM_NAME = "bairro";
const HOUSE_ROOM = "casa";
const SIM_MS = 50; // 20 Hz de simulação
const PATCH_MS = 100; // 10 Hz de estado para os clientes
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
  },
  "MMCasaPlayer"
);
const HouseState = schema({ players: t.map(HousePlayer), level: t.uint8() }, "MMCasa");

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
    // Cada casa com titular: carro na rua; bike, skate e patins na calçada.
    for (const h of await MeuMundoStorage.listHouses(pool, this.neighborhoodId, null)) {
      if (h.ownerName) this.ensureVehicles(h.number);
    }

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
    log.info("room.create", { roomId: this.roomId, neighborhood: this.neighborhoodId });
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
    for (const s of this.sim.values()) if (s.userId === userId) return { x: s.body.x, z: s.body.z, driving: !!s.car };
    return null;
  }

  // ── Veículos (mm3d-11 carro; mm3d-14 bike, skate e patins) ───────────────
  ensureVehicles(lotNumber) {
    for (const kind of KIND_NAMES) {
      const key = String(vehicleId(kind, lotNumber));
      if (this.state.cars.has(key)) continue;
      const p = spotFor(kind, lotNumber);
      this.state.cars.set(key, new Car({ lot: lotNumber, kind, x: p.x, z: p.z, facing: p.facing, driver: "" }));
    }
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
    if (c && c.driver === sessionId) Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0, vx: 0, vz: 0, w: 0 });
    s.car = 0;
    s.veh = null;
    s.drive = IDLE_DRIVE;
  }

  /** Entrada de direção do motorista (acelerador, freio/ré, volante, freio de mão). */
  onDrive(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const d = sanitizeDrive(msg);
    if (s && s.car && d) s.drive = d;
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
      // O carro é só do titular da casa; bike, skate e patins, de quem chegar.
      if (RIDE_KINDS[kind].ownerOnly && (s.visitor || !p.house || p.house !== c.lot)) return deny("not_owner");
      if (c.driver) return deny("busy");
      if (Math.hypot(c.x - s.body.x, c.z - s.body.z) > RIDE_KINDS[kind].enter) return deny("far");
      c.driver = client.sessionId;
      s.car = id;
      s.veh = createVehicle(c.x, c.z, c.facing);
      s.drive = IDLE_DRIVE;
      Object.assign(s.body, { x: c.x, z: c.z, vx: 0, vz: 0, facing: c.facing });
      s.intent = { x: 0, z: 0, run: false };
      Object.assign(p, { car: id, x: c.x, z: c.z, facing: c.facing, move: RIDE_KINDS[kind].move });
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
      const spot = spotFor(kind, c.lot);
      if (!carFits(spot.x, spot.z, spot.facing, this.obstacles.concat(this.carBoxes(client.sessionId)), kind)) return deny("spot_busy");
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
      // Só desce com o carro parado (ou quase).
      if (s.veh && Math.hypot(s.veh.vx, s.veh.vz) > CAR.EXIT_MAX_SPEED) return deny("moving");
      // O carro para onde está; a pessoa desce num ponto LIVRE ao lado.
      Object.assign(c, { x: s.body.x, z: s.body.z, facing: s.body.facing });
      const blockers = this.obstacles.concat(this.carBoxes(client.sessionId), [carBox(c)]);
      const spot = exitSpots(c, MOTION.RADIUS).find((e) => isSafeSpot(e.x, e.z, resolveCircle, MOTION.RADIUS, blockers));
      if (!spot) return deny("blocked");
      Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0, vx: 0, vz: 0, w: 0 });
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
    if (s && intent) s.intent = intent;
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
    for (const [sid, s] of this.sim) {
      const boxes = hasCars ? this.obstacles.concat(this.carBoxes(sid)) : this.obstacles;
      const p = this.state.players.get(sid);
      if (s.car && s.veh) {
        // Dirigindo: a física do carro (passo fixo com acumulador).
        const v = s.veh;
        const c = this.state.cars.get(String(s.car));
        const kind = c && RIDE_KINDS[c.kind] ? c.kind : "car";
        advanceVehicle(v, s.drive, dt, boxes, LIMIT, paramsFor(kind, s.tune));
        Object.assign(s.body, { x: v.x, z: v.z, vx: v.vx, vz: v.vz, facing: v.yaw });
        if (c) Object.assign(c, { x: v.x, z: v.z, facing: v.yaw, sp: v.u, st: v.steer, hb: v.hb > 0.3, sl: v.slip, vx: v.vx, vz: v.vz, w: v.w });
        if (p) Object.assign(p, { x: v.x, z: v.z, facing: v.yaw, move: RIDE_KINDS[kind].move });
        continue;
      }
      const move = step(s.body, s.intent, dt, boxes, LIMIT, paceProfile(s.pace));
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
    roomsByHouse.set(this.houseId, this);
    this.onMessage("in", (client, msg) => this.onIntent(client, msg));
    this.onMessage("sit", (client, msg) => this.onSit(client, msg));
    this.onMessage("stand", (client) => this.onStand(client));
    this.onMessage("bed", (client, msg) => this.onBed(client, msg));
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
      })
    );
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
    // Sair (ou cair) libera o assento: ele é só o campo `seat` do jogador.
    this.sim.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  dropSession(sessionId) {
    this.sim.delete(sessionId);
    this.state.players.delete(sessionId);
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
    for (const s of this.sim.values()) if (s.userId === userId) return { x: s.body.x, z: s.body.z, floor: s.body.floor };
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
    if (s && intent) s.intent = intent;
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
    for (const [sid, s] of this.sim) {
      if (s.seat || s.bed) continue;
      const move = stepInterior(s.body, s.intent, dt, this.def, paceSpeeds(s.pace));
      const p = this.state.players.get(sid);
      if (!p) continue;
      p.x = s.body.x;
      p.z = s.body.z;
      p.y = s.body.y;
      p.floor = s.body.floor;
      p.facing = s.body.facing;
      p.move = move;
    }
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
async function reserveSeat({ neighborhoodId, userId, name, body, arrivalLot = null }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  await ready;
  return matchMaker.joinOrCreate(ROOM_NAME, { neighborhoodId, userId, name, body, arrivalLot });
}

/** Reserva o lugar na sala de uma casa (titular ou convidado já conferidos). */
async function reserveHouseSeat({ houseId, userId, name, body }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  await ready;
  return matchMaker.joinOrCreate(HOUSE_ROOM, { houseId, userId, name, body });
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
  const room = scene === "nb" ? roomsByNeighborhood.get(id) : roomsByHouse.get(id);
  return room ? room.positionOf(userId) : null;
}

async function status() {
  if (!ready) return { available: false };
  await ready;
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  const houses = await matchMaker.query({ name: HOUSE_ROOM });
  return {
    available: true,
    process: "single",
    rooms: rooms.length,
    clients: rooms.reduce((n, r) => n + (r.clients || 0), 0),
    houseRooms: houses.length,
    houseClients: houses.reduce((n, r) => n + (r.clients || 0), 0),
  };
}

// Só para a suíte e2e (test/meu-mundo.e2e.js): alcança as salas vivas.
const _roomFor = (neighborhoodId) => roomsByNeighborhood.get(neighborhoodId) || null;
const _houseRoomFor = (houseId) => roomsByHouse.get(houseId) || null;

module.exports = {
  init,
  reserveSeat,
  reserveHouseSeat,
  status,
  applyHouseLevel,
  houseOccupants,
  dropFromHouse,
  positionIn,
  applyLife,
  isFreeSpot,
  WS_PREFIX,
  BairroRoom,
  CasaRoom,
  CLOSE,
  _roomFor,
  _houseRoomFor,
};
