// src/realtime/meuMundoNoturno.js — MEU MUNDO 3D: Rolê Noturno em grupo (mm3d-42)
//
// Pedido do Alex: "o Rolê Noturno tem que ser multiplayer também, na mesma
// tela como o Antigravidade". Então o mesmo molde da CorridaRoom: uma sala por
// largada, do MESMO centro (filterBy centerRoomId, a mais cheia primeiro),
// espera até LOBBY_MS desde que abriu (ou larga na hora com 6) → tranca →
// contagem → todos correm na MESMA rua → resultado quando o último cai → fecha.
//
// Diferente da corrida, NÃO há computador nem regra no servidor: a rua sai
// toda da semente que a sala sorteia (a mesma para todos, gerada pela curva de
// velocidade da bike — sim/run.ts do front), e a corrida de cada pessoa roda no
// APARELHO dela. A sala só repassa as poses (~20 Hz), recusa o impossível
// (andar mais do que o veículo mais rápido com o poder anda) e monta a
// classificação pelos pontos de quem caiu. Quem sai no meio fica com o que
// tinha ("saiu"). Pontos não valem nada fora da partida (sem moeda da vida).
//
// A pessoa continua presente no centro (como no jetpack/Paint/corrida).

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const presence = require("./meuMundoPresence");
const { roomLook } = require("../utils/meuMundoColors");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.noturno");

const NOTURNO_ROOM = "noturno";
const SEATS = 6;
const RIDES = ["bike", "skate", "skates"];
/** A rua do grupo é gerada pela curva deste veículo (o mais rápido): igual em todos os aparelhos. */
const STREET = "bike";
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const TICK_MS = 50; // 20 Hz
const MAX_MSG_PER_SEC = 45;
const ABUSE_DROPS = 300;
/** Contagem antes do "vai" (s): a mesma do aparelho. */
const COUNTDOWN_S = 3;
/** Mais rápido possível: bike no teto (500 km/h) × o empurrão máximo do poder, com folga. */
const MAX_V = 140 * 1.8;
/** Partida que não acaba (alguém parado com a aba aberta): encerra assim mesmo. */
const MAX_RUN_S = 1800;
/** Sem pose por este tempo no meio da corrida = caiu (aba fechada, rede morta). */
const SILENT_S = 8;

/** Prazos (a suíte e2e encurta). */
const timing = { lobbyMs: 60000, closeMs: 20000 };

const NtPlayer = schema(
  {
    slot: t.uint8(), // ordem de chegada na espera
    name: t.string(),
    ride: t.string(),
    online: t.boolean(),
  },
  "NTPlayer"
);

const NtState = schema(
  {
    phase: t.string(), // "lobby" | "countdown" | "run" | "end"
    until: t.float64(), // ms (epoch): fim da espera ou fechamento depois do fim
    time: t.float32(), // s de corrida (negativo na contagem)
    players: t.map(NtPlayer),
    result: t.string(), // JSON do resultado (fim)
  },
  "NTState"
);

/** userId → { room, sessionId } (uma sessão por pessoa entre as salas do Rolê). */
const byUser = new Map();
/** roomId → sala viva. */
const rooms = new Map();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

class NoturnoRoom extends Room {
  async onCreate(options) {
    this.centerRoomId = String(options.centerRoomId || "");
    this.maxClients = SEATS;
    this.patchRate = 100;
    this.seatReservationTimeout = 15;
    this.setState(new NtState());
    this.state.phase = "lobby";
    this.state.until = Date.now() + timing.lobbyMs;
    /** sessionId → { userId, slot, body, look, ride, run: {...}, bucket, ... } */
    this.seats = new Map();
    this.startedAt = 0;
    this.closeTimer = null;
    rooms.set(this.roomId, this);
    this.onMessage("p", (client, msg) => this.onPose(client, msg));
    this.onMessage("x", (client, msg) => this.onCrash(client, msg));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval(() => this.loop(), TICK_MS);
    log.info("noturno.create", { roomId: this.roomId });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    if (!admin || !sameCenter || this.state.phase !== "lobby") {
      log.warn("noturno.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao rolê");
    }
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId);
    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    // as cores vêm da conta (o aparelho não escolhe a cor dos outros)
    const look = await MeuMundoStorage.getLook(pool, userId).then((l) => roomLook(body, l), () => "");
    const ride = RIDES.includes(options.ride) ? options.ride : "skate";
    const slot = this.freeSlot();
    this.state.players.set(client.sessionId, new NtPlayer({ slot, name: String(options.name || "skatista").slice(0, 24), ride, online: true }));
    this.seats.set(client.sessionId, {
      userId,
      slot,
      body,
      look,
      ride,
      run: null,
      bucket: MAX_MSG_PER_SEC,
      lastRefill: Date.now(),
      drops: 0,
      dropsSince: Date.now(),
    });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    // left = ms até o fim da espera (o aparelho conta pelo relógio dele)
    client.send("welcome", { slot, left: Math.max(0, this.state.until - Date.now()) });
    if (this.seats.size >= SEATS) this.start();
    log.info("noturno.join", { roomId: this.roomId, people: this.seats.size, slot });
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (s.run) {
      // No rolê: fica com o que tinha, como "saiu".
      p.online = false;
      if (s.run.alive) Object.assign(s.run, { alive: false, gone: true });
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
    for (let i = 0; i < SEATS; i++) if (!used.has(i)) return i;
    return 0;
  }

  replace(sessionId) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      client.send("replaced", {});
      client.leave(CLOSE.REPLACED);
    } else {
      const s = this.seats.get(sessionId);
      if (s && s.run) Object.assign(s.run, { alive: false, gone: true });
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

  running(client) {
    const s = this.seats.get(client.sessionId);
    if (!s || !s.run || !s.run.alive || this.state.phase !== "run" || !this.takeToken(client, s)) return null;
    return s;
  }

  /** Só o possível: z não volta e não anda mais do que o mais rápido anda; pontos com teto pela distância. */
  accept(s, msg) {
    const r = s.run;
    const now = Date.now();
    const dt = r.at ? Math.min(3, (now - r.at) / 1000) : 0.5;
    let z = num(msg.z);
    if (!Number.isFinite(z)) return false;
    z = Math.max(r.z - 2, Math.min(r.z + MAX_V * dt + 25, z));
    r.z = Math.max(0, z);
    r.at = now;
    const x = num(msg.x);
    const y = num(msg.y);
    r.x = Number.isFinite(x) ? Math.max(-3, Math.min(3, x)) : r.x;
    r.y = Number.isFinite(y) ? Math.max(0, Math.min(40, y)) : r.y;
    r.f = Math.max(0, Math.min(255, Math.floor(num(msg.f) || 0)));
    r.k = Math.max(0, Math.min(1, num(msg.k) || 0));
    // pontos = metros + moedas + manobras + explosões: nunca mais que ~12× a distância
    const sc = Math.floor(num(msg.s) || 0);
    r.score = Math.max(r.score, Math.min(sc, Math.floor(r.z) * 12 + 500));
    r.coins = Math.max(r.coins, Math.min(Math.floor(num(msg.c) || 0), Math.floor(r.z)));
    return true;
  }

  // ── mensagens ──────────────────────────────────────────────────────────────

  onPose(client, msg) {
    const s = this.running(client);
    if (!s || !msg) return;
    this.accept(s, msg);
  }

  /** Caiu (o aparelho manda o fim dele: distância, pontos, moedas, manobras e o que derrubou). */
  onCrash(client, msg) {
    const s = this.running(client);
    if (!s || !msg) return;
    this.accept(s, msg);
    s.run.alive = false;
    s.run.tricks = Math.max(0, Math.min(10000, Math.floor(num(msg.t) || 0)));
    s.run.by = typeof msg.by === "string" ? msg.by.slice(0, 12) : "";
    s.run.time = this.state.time;
    log.info("noturno.crash", { roomId: this.roomId, slot: s.slot, dist: Math.floor(s.run.z) });
  }

  onPing(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.takeToken(client, s)) return;
    client.send("pong", { c: Number(msg && msg.c) || 0, t: this.state.time });
  }

  // ── partida ────────────────────────────────────────────────────────────────

  start() {
    if (this.startedAt) return;
    const seed = (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0;
    const seats = [...this.seats.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((s) => {
        const p = [...this.state.players.values()].find((q) => q.slot === s.slot);
        s.run = { z: 0, x: 0, y: 0, f: 0, k: 0, score: 0, coins: 0, tricks: 0, alive: true, gone: false, by: "", time: 0, at: 0 };
        return { slot: s.slot, name: p ? p.name : "", ride: s.ride, body: s.body, look: s.look };
      });
    this.startedAt = Date.now();
    this.state.phase = "countdown";
    this.state.time = -COUNTDOWN_S;
    this.state.until = 0;
    void this.lock();
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (s) client.send("start", { me: s.slot, seed, street: STREET, countdown: COUNTDOWN_S, seats });
    }
    log.info("noturno.start", { roomId: this.roomId, people: seats.length });
  }

  loop() {
    if (!this.startedAt) {
      if (this.state.phase === "lobby" && Date.now() >= this.state.until && this.seats.size > 0) this.start();
      return;
    }
    if (this.state.phase === "end") return;
    this.state.time = (Date.now() - this.startedAt) / 1000 - COUNTDOWN_S;
    if (this.state.phase === "countdown" && this.state.time >= 0) this.state.phase = "run";
    if (this.state.phase !== "run") return;
    const now = Date.now();
    for (const s of this.seats.values()) {
      const r = s.run;
      // calado demais no meio do rolê = caiu (sem pose desde o começo conta a partir do "vai")
      const since = r.at || this.startedAt + COUNTDOWN_S * 1000;
      if (r.alive && now - since > SILENT_S * 1000) Object.assign(r, { alive: false, gone: true, time: this.state.time });
    }
    this.snapshot();
    const anyAlive = [...this.seats.values()].some((s) => s.run.alive);
    if (!anyAlive || this.state.time > MAX_RUN_S) this.finish();
  }

  /** Todos a 20 Hz: [slot, z, x, y, bandeiras, manobra, pontos, vivo] por pessoa. */
  snapshot() {
    const c = [];
    for (const s of this.seats.values()) {
      const r = s.run;
      c.push(s.slot, r2(r.z), r3(r.x), r3(r.y), r.f, r2(r.k), r.score, r.alive ? 1 : r.gone ? 2 : 0);
    }
    this.broadcast("s", { t: r3(this.state.time), c });
  }

  finish() {
    const rows = [...this.seats.values()]
      .map((s) => {
        const p = [...this.state.players.values()].find((q) => q.slot === s.slot);
        return {
          slot: s.slot,
          name: p ? p.name : "",
          ride: s.ride,
          score: s.run.score,
          dist: Math.floor(s.run.z),
          coins: s.run.coins,
          tricks: s.run.tricks,
          by: s.run.by,
          gone: s.run.gone,
        };
      })
      .sort((a, b) => b.score - a.score || b.dist - a.dist);
    this.state.result = JSON.stringify({ rows });
    this.state.phase = "end";
    this.state.until = Date.now() + timing.closeMs;
    log.info("noturno.end", { roomId: this.roomId, people: rows.length, best: rows[0] ? rows[0].score : 0 });
    this.closeTimer = this.clock.setTimeout(() => this.disconnect(), timing.closeMs);
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(NOTURNO_ROOM, NoturnoRoom).filterBy(["centerRoomId"]).sortBy({ clients: -1 });
  ready = true;
}

/** Reserva o lugar na próxima largada do centro em que a pessoa está (quem chama já conferiu papel, centro e porta). */
async function reserveNoturnoSeat({ userId, name, centerRoomId, ride, body }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  const options = { centerRoomId, userId, name, ride, body };
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(NOTURNO_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation|locked/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro (voltou para casa): sai do rolê também. */
function leaveNoturno(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId);
}

async function noturnoStatus() {
  const list = await matchMaker.query({ name: NOTURNO_ROOM });
  return { noturnoRooms: list.length, noturnoClients: list.reduce((n, r) => n + (r.clients || 0), 0) };
}

module.exports = {
  define,
  reserveNoturnoSeat,
  leaveNoturno,
  noturnoStatus,
  NOTURNO_ROOM,
  STREET,
  // só para a suíte e2e
  _noturnoRooms: () => [...rooms.values()],
  _noturnoTiming: timing,
};
