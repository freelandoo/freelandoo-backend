// src/realtime/meuMundo.js — MEU MUNDO 3D: multiplayer do bairro (Colyseus 0.18).
//
// ═══ ONDE RODA ═══
// Dentro do processo do backend, no MESMO servidor HTTP (Railway, WebSocket
// duradouro). O transporte do Colyseus só aceita upgrades em `/mm-ws/...`;
// o socket.io continua em `/realtime`. Não existe rota HTTP de matchmaking
// exposta: a reserva de lugar é feita AQUI, chamada pelo endpoint autenticado
// `/meu-mundo/admin/*` — o navegador nunca escolhe sala nem diz quem é.
//
// ⚠️ PROCESSO ÚNICO. O matchmaker usa presença/driver locais (memória). Com
// mais de uma réplica do backend, dois processos poderiam abrir salas
// paralelas para o mesmo bairro. Escalar exige presença/driver compartilhados
// (Redis) — documentado no REGISTRO.md.
//
// ═══ BAIRRO × SALA ═══
// Uma sala lógica por bairro ativo (`filterBy(['neighborhoodId'])`). A sala é
// execução temporária: sem ninguém ela é descartada, e o bairro — casas e
// titulares, no banco — continua igual. Recriar a sala não redistribui nada.
//
// ═══ O QUE TRAFEGA ═══
// Só nome público, posição, orientação, estado de movimento, corpo e número
// da casa. Nada de id de usuário, e-mail, token ou permissão. Modelos e
// animações nunca passam pelo WebSocket.

const { Server, Room, ServerError, matchMaker } = require("@colyseus/core");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const { OBSTACLES, LIMIT, frontOfHouse } = require("../utils/meuMundoLayout");
const { sanitizeIntent, step } = require("../utils/meuMundoMotion");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.realtime");

const WS_PREFIX = "/mm-ws/";
const ROOM_NAME = "bairro";
const SIM_MS = 50; // 20 Hz de simulação
const PATCH_MS = 100; // 10 Hz de estado para os clientes
const MAX_MSG_PER_SEC = 30;
const ABUSE_DROPS = 200; // mensagens descartadas em 10 s → desconecta
const LAST_POS_TTL = 10 * 60 * 1000;
const BODY_COOLDOWN_MS = 800;

const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };

const Player = schema(
  {
    name: t.string(),
    house: t.uint8(),
    body: t.string(),
    x: t.float32(),
    z: t.float32(),
    facing: t.float32(),
    move: t.uint8(),
  },
  "MMPlayer"
);
// residents = titulares do bairro (permanentes); players = quem está online agora.
const State = schema({ players: t.map(Player), residents: t.uint8() }, "MMBairro");

// Última posição por usuário (memória do processo): quem cai e volta em até
// 10 min retorna onde estava; depois disso, à frente da própria casa.
const lastPos = new Map();

function rememberPos(userId, b) {
  lastPos.set(userId, { x: b.x, z: b.z, facing: b.facing, at: Date.now() });
  if (lastPos.size > 500) {
    const cut = Date.now() - LAST_POS_TTL;
    for (const [k, v] of lastPos) if (v.at < cut) lastPos.delete(k);
  }
}

class BairroRoom extends Room {
  onCreate(options) {
    this.neighborhoodId = String(options.neighborhoodId || "");
    this.maxClients = 40;
    this.patchRate = PATCH_MS;
    this.seatReservationTimeout = 20;
    this.setState(new State());
    /** sessionId → dados que NÃO vão para a rede */
    this.sim = new Map();

    this.onMessage("in", (client, msg) => this.onIntent(client, msg));
    this.onMessage("body", (client, msg) => this.onBody(client, msg));
    this.onMessage("*", (client) => this.countMessage(client));
    this.setSimulationInterval((dt) => this.tick(dt), SIM_MS);
    log.info("room.create", { roomId: this.roomId, neighborhood: this.neighborhoodId });
  }

  async onJoin(client, options) {
    // A reserva foi feita pelo backend autenticado; mesmo assim a identidade é
    // reconferida no banco no momento de entrar (papel e residência), porque
    // entre a reserva e a conexão algo pode ter mudado.
    const userId = options.userId;
    const ok =
      options.neighborhoodId === this.neighborhoodId &&
      userId &&
      (await AuthStorage.isAdmin(pool, userId));
    const residence = ok ? await MeuMundoStorage.getActiveResidence(pool, userId) : null;
    if (!residence || residence.id_neighborhood !== this.neighborhoodId) {
      log.warn("join.denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao bairro");
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
    if (!start) {
      const mem = lastPos.get(userId);
      if (mem && Date.now() - mem.at < LAST_POS_TTL) start = mem;
    }
    if (!start) {
      const home = frontOfHouse(residence.lot_number);
      start = { x: home.x, z: home.z, facing: home.rotationY };
    }

    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    const b = { x: start.x, z: start.z, vx: 0, vz: 0, facing: start.facing };
    // Posição de partida também passa pela colisão (memória antiga num lugar
    // que virou obstáculo não pode prender ninguém).
    step(b, { x: 0, z: 0, run: false }, 0, OBSTACLES, LIMIT);
    this.sim.set(client.sessionId, {
      userId,
      body: b,
      intent: { x: 0, z: 0, run: false },
      bucket: MAX_MSG_PER_SEC,
      lastRefill: Date.now(),
      drops: 0,
      dropsSince: Date.now(),
      lastBodyAt: 0,
    });
    this.state.players.set(
      client.sessionId,
      new Player({
        name: String(options.name || "morador").slice(0, 24),
        house: residence.lot_number,
        body,
        x: b.x,
        z: b.z,
        facing: b.facing,
        move: 0,
      })
    );
    // Titulares podem ter mudado (alguém acabou de ganhar uma casa aqui).
    this.state.residents = await MeuMundoStorage.countResidents(pool, this.neighborhoodId);
    client.send("welcome", { x: b.x, z: b.z, facing: b.facing, house: residence.lot_number });
    log.info("join", { roomId: this.roomId, online: this.state.players.size });
  }

  onLeave(client) {
    const s = this.sim.get(client.sessionId);
    if (s) rememberPos(s.userId, s.body);
    this.sim.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    for (const s of this.sim.values()) rememberPos(s.userId, s.body);
    log.info("room.dispose", { roomId: this.roomId });
  }

  /** Limite de frequência por cliente (balde de fichas). */
  countMessage(client) {
    const s = this.sim.get(client.sessionId);
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

  tick(dtMs) {
    const dt = Math.min(dtMs / 1000, 0.25);
    for (const [sid, s] of this.sim) {
      const move = step(s.body, s.intent, dt, OBSTACLES, LIMIT);
      const p = this.state.players.get(sid);
      if (!p) continue;
      p.x = s.body.x;
      p.z = s.body.z;
      p.facing = s.body.facing;
      p.move = move;
    }
  }
}

let ready = null;
let transport = null;

function init(httpServer) {
  if (ready) return ready;
  transport = new WebSocketTransport({ noServer: true, pingInterval: 5000, pingMaxRetries: 3 });
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false });
  gameServer.define(ROOM_NAME, BairroRoom).filterBy(["neighborhoodId"]);
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
 * Reserva o lugar do usuário na sala do bairro DELE. Quem chama já validou a
 * sessão e o papel de administrador. Devolve a reserva que o cliente consome.
 */
async function reserveSeat({ neighborhoodId, userId, name, body }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  await ready;
  return matchMaker.joinOrCreate(ROOM_NAME, { neighborhoodId, userId, name, body });
}

async function status() {
  if (!ready) return { available: false };
  await ready;
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  return {
    available: true,
    process: "single",
    rooms: rooms.length,
    clients: rooms.reduce((n, r) => n + (r.clients || 0), 0),
  };
}

module.exports = { init, reserveSeat, status, WS_PREFIX, BairroRoom, CLOSE };
