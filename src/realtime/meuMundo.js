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
// corpo e número da casa. Nada de id de usuário, e-mail, token ou permissão.
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
const { SEAT_REACH } = require("../utils/meuMundoInteriorKit");
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
const { MOTION, sanitizeIntent, step, resolveCircle } = require("../utils/meuMundoMotion");
const { CAR, parkingSpot, carBox, carFits, exitSpots } = require("../utils/meuMundoCars");
const {
  IDLE: IDLE_DRIVE,
  tuned,
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
const BODY_COOLDOWN_MS = 800;
const MAX_VISITORS = 20; // um visitante por titular (20 casas)

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
    // Lote do carro que a pessoa está dirigindo (0 = a pé). Dirigindo, x/z
    // são os do carro e o boneco não aparece.
    car: t.uint8(),
  },
  "MMPlayer"
);
// Carro de uma casa (chave = número do lote). driver = sessionId de quem
// dirige ("" = estacionado). mm3d-12: sp = velocidade longitudinal (m/s, <0
// = ré), st = esterçamento das rodas (rad), hb = freio de mão puxado,
// sl = 0..1 quanto a traseira escorrega — o que os OUTROS precisam para
// animar rodas, curva e derrapagem sem rodar outra física.
const Car = schema(
  {
    lot: t.uint8(),
    x: t.float32(),
    z: t.float32(),
    facing: t.float32(),
    driver: t.string(),
    sp: t.float32(),
    st: t.float32(),
    hb: t.boolean(),
    sl: t.float32(),
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

// Dentro da casa: andar, altura e assento. move 3 = sentado.
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
    // Um carro por casa com titular, na vaga da casa.
    for (const h of await MeuMundoStorage.listHouses(pool, this.neighborhoodId, null)) {
      if (h.ownerName) this.ensureCar(h.number);
    }

    this.onMessage("in", (client, msg) => this.onIntent(client, msg));
    this.onMessage("car", (client, msg) => this.onCar(client, msg));
    this.onMessage("drive", (client, msg) => this.onDrive(client, msg));
    this.onMessage("tune", (client, msg) => this.onTune(client, msg));
    this.onMessage("body", (client, msg) => this.onBody(client, msg));
    this.onMessage("*", (client) => this.countMessage(client));
    this.setSimulationInterval((dt) => this.tick(dt), SIM_MS);
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
      lastBodyAt: 0,
      car: 0,
      // Dirigindo (mm3d-12): física do carro, entrada e ajustes do painel.
      veh: null,
      drive: IDLE_DRIVE,
      tune: null,
      lastRecoverAt: 0,
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
      })
    );
    if (resident) this.ensureCar(residence.lot_number);
    // Titulares podem ter mudado (alguém acabou de ganhar uma casa aqui).
    this.state.residents = await MeuMundoStorage.countResidents(pool, this.neighborhoodId);
    presence.claim(userId, this, client.sessionId, "nb", this.neighborhoodId);
    presence.setPlacement(userId, { scene: "nb", nbId: this.neighborhoodId });
    client.send("welcome", { x: b.x, z: b.z, facing: b.facing, house: residence.lot_number, visitor });
    log.info("join", { roomId: this.roomId, online: this.state.players.size, visitor });
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

  // ── Carros (mm3d-11) ──────────────────────────────────────────────────────
  ensureCar(lotNumber) {
    const key = String(lotNumber);
    if (this.state.cars.has(key)) return;
    const p = parkingSpot(lotNumber);
    this.state.cars.set(key, new Car({ lot: lotNumber, x: p.x, z: p.z, facing: p.facing, driver: "" }));
  }

  /** Caixas dos carros que bloqueiam `sessionId` (todos menos o que ele dirige). */
  carBoxes(sessionId) {
    const out = [];
    this.state.cars.forEach((c) => {
      if (c.driver && c.driver === sessionId) return;
      out.push(carBox(c));
    });
    return out;
  }

  /** Quem dirigia sai da sala (queda, troca de sessão): o carro fica onde está. */
  parkCar(sessionId, s) {
    if (!s.car) return;
    const c = this.state.cars.get(String(s.car));
    if (c && c.driver === sessionId) Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0 });
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
      // Só o titular dirige o carro da própria casa; visitante anda a pé.
      if (s.visitor || !p.house) return deny("not_owner");
      const c = this.state.cars.get(String(p.house));
      if (!c) return deny("no_car");
      if (c.driver) return deny("busy");
      if (Math.hypot(c.x - s.body.x, c.z - s.body.z) > CAR.ENTER_RADIUS) return deny("far");
      c.driver = client.sessionId;
      s.car = c.lot;
      s.veh = createVehicle(c.x, c.z, c.facing);
      s.drive = IDLE_DRIVE;
      Object.assign(s.body, { x: c.x, z: c.z, vx: 0, vz: 0, facing: c.facing });
      s.intent = { x: 0, z: 0, run: false };
      Object.assign(p, { car: c.lot, x: c.x, z: c.z, facing: c.facing, move: 0 });
      client.send("moved", { x: c.x, z: c.z, facing: c.facing, car: c.lot });
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
      const spot = parkingSpot(c.lot);
      if (!carFits(spot.x, spot.z, spot.facing, this.obstacles.concat(this.carBoxes(client.sessionId)))) return deny("spot_busy");
      s.lastRecoverAt = now;
      s.veh = createVehicle(spot.x, spot.z, spot.facing);
      Object.assign(s.body, { x: spot.x, z: spot.z, vx: 0, vz: 0, facing: spot.facing });
      Object.assign(c, { x: spot.x, z: spot.z, facing: spot.facing, sp: 0, st: 0, hb: false, sl: 0 });
      Object.assign(p, { x: spot.x, z: spot.z, facing: spot.facing });
      client.send("moved", { x: spot.x, z: spot.z, facing: spot.facing, car: c.lot });
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
      Object.assign(c, { driver: "", sp: 0, st: 0, hb: false, sl: 0 });
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

  onBody(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const body = msg && msg.body;
    if (!s || !MeuMundoStorage.BODIES.includes(body)) return;
    const now = Date.now();
    if (now - s.lastBodyAt < BODY_COOLDOWN_MS) return;
    s.lastBodyAt = now;
    const p = this.state.players.get(client.sessionId);
    if (p) p.body = body;
    MeuMundoStorage.setBody(pool, s.userId, body).catch((err) =>
      log.error("body.persist_fail", { message: err.message })
    );
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
        advanceVehicle(v, s.drive, dt, boxes, LIMIT, tuned(s.tune));
        Object.assign(s.body, { x: v.x, z: v.z, vx: v.vx, vz: v.vz, facing: v.yaw });
        const c = this.state.cars.get(String(s.car));
        if (c) Object.assign(c, { x: v.x, z: v.z, facing: v.yaw, sp: v.u, st: v.steer, hb: v.hb > 0.3, sl: v.slip });
        if (p) Object.assign(p, { x: v.x, z: v.z, facing: v.yaw, move: 0 });
        continue;
      }
      const move = step(s.body, s.intent, dt, boxes, LIMIT);
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
    this.onMessage("body", (client, msg) => this.onBody(client, msg));
    this.onMessage("sit", (client, msg) => this.onSit(client, msg));
    this.onMessage("stand", (client) => this.onStand(client));
    this.onMessage("*", (client) => this.countMessage(client));
    this.setSimulationInterval((dt) => this.tick(dt), SIM_MS);
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
      intent: { x: 0, z: 0, run: false },
      ...freshBucket(),
      lastBodyAt: 0,
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
      })
    );
    presence.claim(userId, this, client.sessionId, "house", this.houseId);
    presence.setPlacement(userId, { scene: "house", houseId: this.houseId, nbId: house.id_neighborhood, lot: house.lot_number });
    client.send("welcome", { x: b.x, z: b.z, facing: b.facing, floor: b.floor, host: isOwner });
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

  onBody(client, msg) {
    if (!this.countMessage(client)) return;
    const s = this.sim.get(client.sessionId);
    const body = msg && msg.body;
    if (!s || !MeuMundoStorage.BODIES.includes(body)) return;
    const now = Date.now();
    if (now - s.lastBodyAt < BODY_COOLDOWN_MS) return;
    s.lastBodyAt = now;
    const p = this.state.players.get(client.sessionId);
    if (p) p.body = body;
    MeuMundoStorage.setBody(pool, s.userId, body).catch((err) => log.error("body.persist_fail", { message: err.message }));
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
    if (!s || !s.seat) return;
    this.standUp(client.sessionId, s);
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
      if (s.seat) continue;
      const move = stepInterior(s.body, s.intent, dt, this.def);
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
  isFreeSpot,
  WS_PREFIX,
  BairroRoom,
  CasaRoom,
  CLOSE,
  _roomFor,
  _houseRoomFor,
};
