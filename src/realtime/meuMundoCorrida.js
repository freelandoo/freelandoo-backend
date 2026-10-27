// src/realtime/meuMundoCorrida.js — MEU MUNDO 3D: Corrida antigravidade em grupo (mm3d-39b)
//
// Pedido do Alex: "sozinho ou multiplayer; quem estiver na hora entra junto e
// o resto é computador; espera 1 minuto; se passou o minuto e só tem eu,
// corro contra 5 computadores". Então: uma sala por largada, do MESMO centro
// (filterBy centerRoomId, a mais cheia primeiro). Espera até LOBBY_MS desde
// que abriu (ou larga na hora com 6 pessoas) → tranca → as vagas que sobram
// viram computador (sempre 6 naves) → contagem → corrida → resultado no
// estado → fecha 20 s depois. Sozinho NÃO passa por aqui (é no aparelho).
//
// O servidor roda a regra do navegador (utils/meuMundoCorrida.js, GERADO do
// TS): os computadores, as cápsulas (quem pega primeiro leva), as voltas, a
// chegada e o resultado. A nave de cada jogador é do APARELHO dele (como o
// movimento no Paint): a pose chega a ~20 Hz e a sala só recusa o impossível
// (andar mais do que a nave anda). Quem cai no meio da corrida sai dela (fica
// no fim da classificação como "não terminou").
//
// A pessoa continua presente no centro (como no jetpack/Paint).

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const presence = require("./meuMundoPresence");
const { Race, TUNING, BAIA, buildTrack } = require("../utils/meuMundoCorrida");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.corrida");

const CORRIDA_ROOM = "corrida";
const CARS = 6;
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const TICK_MS = 1000 / 60;
const SNAP_EVERY = 3; // a cada 3 ticks = 20 Hz
const MAX_MSG_PER_SEC = 45;
const ABUSE_DROPS = 300;
/** Corrida que não acaba (todo mundo parado): encerra assim mesmo. */
const MAX_RACE_S = 420;

/** Prazos (a suíte e2e encurta). */
const timing = { lobbyMs: 60000, closeMs: 20000 };

const TRACK = buildTrack(BAIA);

const CrPlayer = schema(
  {
    slot: t.uint8(), // ordem de chegada na espera
    car: t.int8(), // nave na corrida (−1 na espera)
    name: t.string(),
    online: t.boolean(),
  },
  "CRPlayer"
);

const CrState = schema(
  {
    phase: t.string(), // "lobby" | "countdown" | "race" | "end"
    until: t.float64(), // ms (epoch): fim da espera ou fechamento depois do fim
    time: t.float32(), // s de corrida (negativo na contagem)
    seats: t.string(), // JSON [{ name, human }] na ordem das naves (depois da espera)
    orbs: t.map("float32"), // cápsula fora → s até voltar
    players: t.map(CrPlayer),
    result: t.string(), // JSON do resultado (fim)
  },
  "CRState"
);

/** userId → { room, sessionId } (uma sessão por pessoa entre as salas da corrida). */
const byUser = new Map();
/** roomId → sala viva. */
const rooms = new Map();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

class CorridaRoom extends Room {
  async onCreate(options) {
    this.centerRoomId = String(options.centerRoomId || "");
    this.maxClients = CARS;
    this.patchRate = 50;
    this.seatReservationTimeout = 15;
    this.setState(new CrState());
    this.state.phase = "lobby";
    this.state.until = Date.now() + timing.lobbyMs;
    /** sessionId → { userId, slot, car, bucket, ..., lastPoseAt } */
    this.seats = new Map();
    this.race = null;
    this.acc = 0;
    this.ticks = 0;
    this.events = [];
    this.closeTimer = null;
    rooms.set(this.roomId, this);
    this.onMessage("p", (client, msg) => this.onPose(client, msg));
    this.onMessage("o", (client, msg) => this.onOrb(client, msg));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval((dt) => this.loop(dt), TICK_MS);
    log.info("corrida.create", { roomId: this.roomId });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    if (!admin || !sameCenter || this.state.phase !== "lobby") {
      log.warn("corrida.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado à corrida");
    }
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId);
    const slot = this.freeSlot();
    this.state.players.set(client.sessionId, new CrPlayer({ slot, car: -1, name: String(options.name || "piloto").slice(0, 24), online: true }));
    this.seats.set(client.sessionId, { userId, slot, car: -1, bucket: MAX_MSG_PER_SEC, lastRefill: Date.now(), drops: 0, dropsSince: Date.now(), poseAt: 0 });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    // left = ms até o fim da espera (o aparelho conta pelo relógio dele)
    client.send("welcome", { slot, until: this.state.until, left: Math.max(0, this.state.until - Date.now()) });
    if (this.seats.size >= CARS) this.start();
    log.info("corrida.join", { roomId: this.roomId, people: this.seats.size, slot });
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (this.race) {
      // Na corrida: a nave sai da pista e fica como "não terminou".
      p.online = false;
      if (this.race.phase !== "end") this.race.markGone(s.car);
      if (!this.clients.length) this.disconnect();
      return;
    }
    this.seats.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    rooms.delete(this.roomId);
    for (const s of this.seats.values()) {
      const mine = byUser.get(s.userId);
      if (mine && mine.room === this) byUser.delete(s.userId);
    }
    if (this.closeTimer) this.closeTimer.clear();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  freeSlot() {
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    for (let i = 0; i < CARS; i++) if (!used.has(i)) return i;
    return 0;
  }

  replace(sessionId) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      client.send("replaced", {});
      client.leave(CLOSE.REPLACED);
    } else {
      const s = this.seats.get(sessionId);
      if (s && this.race) this.race.markGone(s.car);
      else {
        this.seats.delete(sessionId);
        this.state.players.delete(sessionId);
      }
    }
  }

  takeToken(client, s) {
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

  racing(client) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.race || this.race.phase === "end" || s.car < 0 || !this.takeToken(client, s)) return null;
    return s;
  }

  // ── mensagens ──────────────────────────────────────────────────────────────

  onPose(client, msg) {
    const s = this.racing(client);
    if (!s || !msg || this.race.phase !== "race") return;
    const c = this.race.cars[s.car];
    if (!c || c.gone) return;
    const r = {
      dist: num(msg.d),
      u: num(msg.u),
      Y: num(msg.y),
      yaw: num(msg.w),
      v: num(msg.v),
      vy: num(msg.vy),
      air: !!(msg.f & 1),
      boost: !!(msg.f & 2),
      down: !!(msg.f & 4),
      steer: Math.max(-1, Math.min(1, num(msg.s) || 0)),
      throttle: Math.max(0, Math.min(1, num(msg.th) || 0)),
    };
    if (![r.dist, r.u, r.Y, r.yaw, r.v].every(Number.isFinite)) return;
    // Só o possível: a nave não anda mais do que o turbo deixa (o pulo de volta
    // depois de cair no vão é a maior "distância" legítima, ~190 m).
    const now = Date.now();
    const dt = s.poseAt ? Math.min(2, (now - s.poseAt) / 1000) : 0.5;
    s.poseAt = now;
    const maxAdv = TUNING.boostMax * 1.6 * dt + 230;
    if (r.dist > c.dist + maxAdv) r.dist = c.dist + maxAdv;
    if (r.dist < c.dist - 40) r.dist = c.dist - 40;
    const half = TRACK.width / 2;
    r.u = Math.max(-half, Math.min(half, r.u));
    r.Y = Math.max(-120, Math.min(200, r.Y));
    r.v = Math.max(0, Math.min(TUNING.boostMax * 1.2, r.v));
    r.vy = Number.isFinite(r.vy) ? Math.max(-80, Math.min(80, r.vy)) : 0;
    this.race.applyRemote(s.car, r, this.events);
  }

  onOrb(client, msg) {
    const s = this.racing(client);
    if (!s || !msg) return;
    const id = Math.floor(num(msg.id));
    if (!Number.isInteger(id)) return;
    if (!this.race.claimOrb(s.car, id, this.events)) client.send("deny", { orb: id });
  }

  onPing(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.takeToken(client, s)) return;
    client.send("pong", { c: Number(msg && msg.c) || 0, t: this.race ? this.race.time : 0 });
  }

  // ── corrida ────────────────────────────────────────────────────────────────

  start() {
    if (this.race) return;
    // Os jogadores largam atrás (como sozinho), na ordem em que chegaram; o resto é computador.
    const people = [...this.seats.entries()].sort((a, b) => a[1].slot - b[1].slot);
    const seats = [];
    people.forEach(([sid, s], i) => {
      s.car = i;
      const p = this.state.players.get(sid);
      p.car = i;
      seats.push({ name: p.name, kind: "remote" });
    });
    while (seats.length < CARS) seats.push({ name: "", kind: "bot" });
    this.race = new Race({ track: TRACK, seats, me: -1, seed: (Date.now() & 0xffff) | 1 });
    const pub = this.race.cars.map((c) => ({ name: c.name, human: c.kind !== "bot" }));
    this.state.seats = JSON.stringify(pub);
    this.state.phase = "countdown";
    this.state.time = this.race.time;
    this.state.until = 0;
    void this.lock();
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (s) client.send("start", { me: s.car, seats: pub });
    }
    log.info("corrida.start", { roomId: this.roomId, people: people.length });
  }

  loop(dtMs) {
    if (!this.race) {
      if (this.state.phase === "lobby" && Date.now() >= this.state.until && this.seats.size > 0) this.start();
      return;
    }
    const race = this.race;
    if (race.phase !== "end") {
      this.acc += Math.min(dtMs, 250) / 1000;
      const idle = { steer: 0, throttle: 0, brake: 0, turbo: false };
      while (this.acc >= TUNING.step) {
        this.acc -= TUNING.step;
        race.step(idle, this.events);
      }
      if (race.time > MAX_RACE_S) race.end(this.events);
    }
    this.events.length = 0;
    this.state.time = race.time;
    if (race.phase !== "countdown" && this.state.phase === "countdown") this.state.phase = "race";
    // cápsulas fora (quem chega depois vê; o aparelho não pede as que já foram)
    for (const [id, left] of race.orbOut) this.state.orbs.set(String(id), r2(left));
    for (const id of [...this.state.orbs.keys()]) if (!race.orbOut.has(Number(id))) this.state.orbs.delete(id);
    if (++this.ticks % SNAP_EVERY === 0 && race.phase !== "end") this.snapshot();
    if (race.phase === "end" && this.state.phase !== "end") this.finish();
  }

  /** As naves a 20 Hz: [dist, u, Y, yaw, v, vy, bandeiras, volante, acelerador] por nave. */
  snapshot() {
    const c = [];
    for (const car of this.race.cars) {
      const flags = (car.air ? 1 : 0) | (car.boost > 0 ? 2 : 0) | (car.down > 0 ? 4 : 0) | (car.gone ? 8 : 0);
      c.push(r2(car.dist), r3(car.u), r3(car.Y), r3(car.yaw), r2(car.v), r2(car.vy), flags, r2(car.steerNow), r2(car.throttleNow));
    }
    this.broadcast("s", { t: r3(this.race.time), c });
  }

  finish() {
    const rows = this.race.standings().map((c) => ({
      car: c.id,
      name: c.name,
      human: c.kind !== "bot",
      time: c.finished,
      best: c.laps.length ? Math.min(...c.laps) : null,
      gone: c.gone,
    }));
    this.state.result = JSON.stringify({ rows });
    this.state.phase = "end";
    this.state.until = Date.now() + timing.closeMs;
    log.info("corrida.end", { roomId: this.roomId, winnerHuman: !!(rows[0] && rows[0].human) });
    this.closeTimer = this.clock.setTimeout(() => this.disconnect(), timing.closeMs);
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(CORRIDA_ROOM, CorridaRoom).filterBy(["centerRoomId"]).sortBy({ clients: -1 });
  ready = true;
}

/** Reserva o lugar numa largada do centro em que a pessoa está (quem chama já conferiu papel, centro e porta). */
async function reserveCorridaSeat({ userId, name, centerRoomId }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  const options = { centerRoomId, userId, name };
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(CORRIDA_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation|locked/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro (voltou para casa): sai da corrida também. */
function leaveCorrida(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId);
}

async function corridaStatus() {
  const list = await matchMaker.query({ name: CORRIDA_ROOM });
  return { corridaRooms: list.length, corridaClients: list.reduce((n, r) => n + (r.clients || 0), 0) };
}

module.exports = {
  define,
  reserveCorridaSeat,
  leaveCorrida,
  corridaStatus,
  CORRIDA_ROOM,
  // só para a suíte e2e
  _corridaRooms: () => [...rooms.values()],
  _corridaTiming: timing,
};
