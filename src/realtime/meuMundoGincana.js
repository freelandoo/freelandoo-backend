// src/realtime/meuMundoGincana.js — MEU MUNDO 3D: Gincana em grupo (mm3d-47)
//
// Corrida de obstáculos sobre o mar (pedido do Alex: a dinâmica do vídeo,
// com os nossos personagens). Mesmo molde do Rolê Noturno: uma sala por
// largada, do MESMO centro (filterBy centerRoomId, a mais cheia primeiro),
// espera até LOBBY_MS desde que abriu (ou larga na hora com 8) → tranca →
// contagem → prova → resultado → fecha.
//
// Diferente do Rolê, as vagas que sobram ficam com o COMPUTADOR, rodado AQUI
// com a regra única (src/utils/meuMundoGincana.js, GERADO do TS do front). O
// percurso é função do tempo da prova: barras, pêndulos, luvas e bolas ficam
// no mesmo lugar em todos os aparelhos sem viajar. O corpo de cada pessoa é
// do APARELHO dela (pose a 20 Hz); a sala recusa o impossível (andar mais do
// que o mergulho e a pancada empurram, chegar sem passar pela subida, posto
// pulado) e devolve todas as poses a 20 Hz. A prova acaba quando todas as
// pessoas chegaram ou saíram, ou no tempo limite; quem não chegou fica pela
// distância. Sem moeda da vida (como os outros minijogos do centro).
//
// A pessoa continua presente no centro (como no Rolê/Paint/corrida).

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const presence = require("./meuMundoPresence");
const { roomLook, PALETTE, PARTS } = require("../utils/meuMundoColors");
const G = require("../utils/meuMundoGincana");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.gincana");

const GINCANA_ROOM = "gincana";
const SEATS = 8;
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const TICK_MS = 50; // 20 Hz
const MAX_MSG_PER_SEC = 45;
const ABUSE_DROPS = 300;
const COUNTDOWN_S = G.GINCANA.countdown;
/** Mais rápido possível no chão/ar (mergulho embalado ou pancada), com folga. */
const MAX_V = 18;
/** Sem pose por este tempo no meio da prova = saiu (aba fechada, rede morta). */
const SILENT_S = 8;
/** Ninguém chega antes disto (o percurso tem ~270 m). */
const MIN_FINISH_S = 22;

/** Computadores: nomes de doce (iguais nos três idiomas) e corpos variados. */
const BOT_NAMES = ["Pipoca", "Jujuba", "Paçoca", "Cocada", "Quindim", "Bolacha", "Brigadeiro", "Pudim", "Canjica", "Suspiro"];
const BOT_BODIES = ["normal", "female", "slim", "strong", "fat", "female", "normal", "slim"];

/** Prazos (a suíte e2e encurta). */
const timing = { lobbyMs: 60000, closeMs: 20000 };

const GnPlayer = schema(
  {
    slot: t.uint8(),
    name: t.string(),
    online: t.boolean(),
  },
  "GNPlayer"
);

const GnState = schema(
  {
    phase: t.string(), // "lobby" | "countdown" | "run" | "end"
    until: t.float64(), // ms (epoch): fim da espera ou fechamento depois do fim
    time: t.float32(), // s de prova (negativo na contagem)
    players: t.map(GnPlayer),
    result: t.string(), // JSON do resultado (fim)
  },
  "GNState"
);

/** userId → { room, sessionId } (uma sessão por pessoa entre as salas da Gincana). */
const byUser = new Map();
/** roomId → sala viva. */
const rooms = new Map();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

class GincanaRoom extends Room {
  async onCreate(options) {
    this.centerRoomId = String(options.centerRoomId || "");
    this.maxClients = SEATS;
    this.patchRate = 100;
    this.seatReservationTimeout = 15;
    this.setState(new GnState());
    this.state.phase = "lobby";
    this.state.until = Date.now() + timing.lobbyMs;
    /** sessionId → { userId, slot, body, look, at, bucket, ... } */
    this.seats = new Map();
    /** A prova (regra única) e os nomes das vagas. */
    this.race = null;
    this.names = new Map();
    this.bots = new Set();
    this.startedAt = 0;
    this.closeTimer = null;
    rooms.set(this.roomId, this);
    this.onMessage("p", (client, msg) => this.onPose(client, msg));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval(() => this.loop(), TICK_MS);
    log.info("gincana.create", { roomId: this.roomId });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    if (!admin || !sameCenter || this.state.phase !== "lobby") {
      log.warn("gincana.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado à gincana");
    }
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId);
    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    // as cores vêm da conta (o aparelho não escolhe a cor dos outros)
    const look = await MeuMundoStorage.getLook(pool, userId).then((l) => roomLook(body, l), () => "");
    const slot = this.freeSlot();
    this.state.players.set(client.sessionId, new GnPlayer({ slot, name: String(options.name || "jogador").slice(0, 24), online: true }));
    this.seats.set(client.sessionId, { userId, slot, body, look, at: 0, gone: false, bucket: MAX_MSG_PER_SEC, lastRefill: Date.now(), drops: 0, dropsSince: Date.now() });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    client.send("welcome", { slot, left: Math.max(0, this.state.until - Date.now()) });
    if (this.seats.size >= SEATS) this.start();
    log.info("gincana.join", { roomId: this.roomId, people: this.seats.size, slot });
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (this.race) {
      // na prova: fica com o que tinha, como "saiu"
      p.online = false;
      this.markGone(s);
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

  markGone(s) {
    if (s.gone) return;
    s.gone = true;
    if (this.race) this.race.setGone(s.slot);
  }

  replace(sessionId) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      client.send("replaced", {});
      client.leave(CLOSE.REPLACED);
    } else {
      const s = this.seats.get(sessionId);
      if (s && this.race) this.markGone(s);
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

  /**
   * Só o possível: anda no máximo MAX_V (folga de 2 m); volta para trás só
   * para um posto já alcançado (caiu na água); posto um de cada vez e só
   * passando por ele; chegada só no alto, depois do mínimo de tempo.
   */
  accept(s, msg) {
    const b = this.race.runner(s.slot);
    if (!b || b.fin >= 0) return;
    const now = Date.now();
    const dt = s.at ? Math.min(3, (now - s.at) / 1000) : 0.5;
    let x = num(msg.x);
    let y = num(msg.y);
    let z = num(msg.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    x = Math.max(-40, Math.min(40, x));
    y = Math.max(-12, Math.min(30, y));
    z = Math.max(-12, Math.min(G.FINISH_Z + 12, z));
    const d = Math.hypot(x - b.x, z - b.z);
    const reach = MAX_V * dt + 2;
    if (d > reach) {
      // volta ao posto (caiu na água): até o posto alcançado
      const back = [];
      for (let cp = 0; cp <= b.cp; cp++) back.push(G.spawnAt(cp, s.slot));
      if (!back.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) {
        const k = reach / d;
        x = b.x + (x - b.x) * k;
        z = b.z + (z - b.z) * k;
      }
    }
    let cp = Math.max(0, Math.floor(num(msg.cp) || 0));
    if (cp > b.cp) cp = G.CHECKPOINTS[b.cp + 1] && z >= G.CHECKPOINTS[b.cp + 1].z - 3 ? b.cp + 1 : b.cp;
    else cp = b.cp;
    const a = Math.max(0, Math.min(8, Math.floor(num(msg.a) || 0)));
    let fin = -1;
    const n = num(msg.n);
    const t = this.state.time;
    if (Number.isFinite(n) && n >= 0 && z >= G.FINISH_Z - 2 && y >= G.FINISH_Y - 1 && t >= MIN_FINISH_S && cp >= G.CHECKPOINTS.length - 1) {
      // o tempo é o da sala (o aparelho só atrasa ~meia volta da rede)
      fin = Math.max(t - 0.6, Math.min(t, n));
    }
    s.at = now;
    this.race.setRemote(s.slot, { x, y, z, f: num(msg.f) || 0, a, cp, fin });
    if (fin >= 0) log.info("gincana.finish", { roomId: this.roomId, slot: s.slot, t: r2(fin) });
  }

  // ── mensagens ──────────────────────────────────────────────────────────────

  onPose(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || s.gone || !this.race || this.state.phase !== "run" || !msg || !this.takeToken(client, s)) return;
    this.accept(s, msg);
  }

  onPing(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.takeToken(client, s)) return;
    client.send("pong", { c: Number(msg && msg.c) || 0, t: this.state.time });
  }

  // ── prova ──────────────────────────────────────────────────────────────────

  start() {
    if (this.startedAt) return;
    const seed = (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0;
    const humans = new Map([...this.seats.values()].map((s) => [s.slot, s]));
    const seats = [];
    let bot = 0;
    for (let slot = 0; slot < SEATS; slot++) {
      const h = humans.get(slot);
      if (h) {
        const p = [...this.state.players.values()].find((q) => q.slot === slot);
        const name = p ? p.name : "";
        this.names.set(slot, name);
        seats.push({ slot, name, body: h.body, look: h.look, bot: false });
        continue;
      }
      const name = BOT_NAMES[(seed + bot++) % BOT_NAMES.length];
      const look = PARTS.map((part, i) => Math.floor(G.botRand(seed, slot, 40 + i) * PALETTE[part].length).toString(36)).join("");
      this.names.set(slot, name);
      this.bots.add(slot);
      seats.push({ slot, name, body: BOT_BODIES[slot % BOT_BODIES.length], look, bot: true });
    }
    this.race = new G.GincanaRace(
      seed,
      seats.map((s) => ({ slot: s.slot, ctl: s.bot ? "bot" : "remote" })),
      COUNTDOWN_S
    );
    this.startedAt = Date.now();
    this.state.phase = "countdown";
    this.state.time = -COUNTDOWN_S;
    this.state.until = 0;
    void this.lock();
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (s) client.send("start", { me: s.slot, seed, countdown: COUNTDOWN_S, seats });
    }
    log.info("gincana.start", { roomId: this.roomId, people: humans.size, bots: this.bots.size });
  }

  loop() {
    if (!this.startedAt) {
      if (this.state.phase === "lobby" && Date.now() >= this.state.until && this.seats.size > 0) this.start();
      return;
    }
    if (this.state.phase === "end") return;
    this.state.time = (Date.now() - this.startedAt) / 1000 - COUNTDOWN_S;
    if (this.state.phase === "countdown" && this.state.time >= 0) this.state.phase = "run";
    // computadores (e os ladrilhos) andam no relógio da sala
    this.race.advance(this.state.time, undefined, null, 12);
    if (this.state.phase !== "run") return this.snapshot();
    const now = Date.now();
    for (const s of this.seats.values()) {
      if (s.gone) continue;
      const since = s.at || this.startedAt + COUNTDOWN_S * 1000;
      const b = this.race.runner(s.slot);
      if (b && b.fin < 0 && now - since > SILENT_S * 1000) this.markGone(s);
    }
    this.snapshot();
    if (this.race.over() || this.state.time > G.GINCANA.timeLimit + 2) this.finish();
  }

  /** Todos a 20 Hz: [vaga, x, y, z, rumo, animação, posto, chegada] por corredor. */
  snapshot() {
    const c = [];
    for (const b of this.race.runners) {
      const p = this.race.pose(b.slot);
      c.push(b.slot, r3(p.x), r3(p.y), r2(p.z), r2(p.f), p.a, p.cp, r2(p.fin));
    }
    this.broadcast("s", { t: r3(this.state.time), c });
  }

  finish() {
    const gone = new Set([...this.seats.values()].filter((s) => s.gone).map((s) => s.slot));
    const rows = this.race.standings().map((r) => ({
      slot: r.slot,
      name: this.names.get(r.slot) || "",
      bot: this.bots.has(r.slot),
      fin: r.fin >= 0 ? r2(r.fin) : -1,
      dist: Math.round(r.dist),
      gone: gone.has(r.slot),
    }));
    this.state.result = JSON.stringify({ rows });
    this.state.phase = "end";
    this.state.until = Date.now() + timing.closeMs;
    log.info("gincana.end", { roomId: this.roomId, people: this.seats.size, first: rows[0] ? rows[0].slot : -1 });
    this.closeTimer = this.clock.setTimeout(() => this.disconnect(), timing.closeMs);
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(GINCANA_ROOM, GincanaRoom).filterBy(["centerRoomId"]).sortBy({ clients: -1 });
  ready = true;
}

/** Reserva o lugar na próxima largada do centro em que a pessoa está (quem chama já conferiu papel, centro e porta). */
async function reserveGincanaSeat({ userId, name, centerRoomId, body }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  const options = { centerRoomId, userId, name, body };
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(GINCANA_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation|locked/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro (voltou para casa): sai da gincana também. */
function leaveGincana(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId);
}

async function gincanaStatus() {
  const list = await matchMaker.query({ name: GINCANA_ROOM });
  return { gincanaRooms: list.length, gincanaClients: list.reduce((n, r) => n + (r.clients || 0), 0) };
}

module.exports = {
  define,
  reserveGincanaSeat,
  leaveGincana,
  gincanaStatus,
  GINCANA_ROOM,
  // só para a suíte e2e
  _gincanaRooms: () => [...rooms.values()],
  _gincanaTiming: timing,
};
