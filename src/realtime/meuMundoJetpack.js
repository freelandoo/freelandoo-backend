// src/realtime/meuMundoJetpack.js — MEU MUNDO 3D: jetpack no túnel (mm3d-63)
//
// Redesenho total do jetpack (pedido do Alex): o personagem voa sem parar por
// um túnel subterrâneo steampunk, desviando de prensas que se mexem e pegando
// galões de combustível. A regra fica SÓ no front (features/meu-mundo/jetpack/
// sim/flight.ts): o túnel inteiro sai de uma SEMENTE, então em grupo todos
// voam o MESMO túnel e cada aparelho roda o seu voo — o molde do Rolê Noturno.
//
// Uma sala por largada, do MESMO centro (filterBy centerRoomId + solo, a mais
// cheia primeiro): em GRUPO espera até LOBBY_MS desde que abriu (ou larga na
// hora com 6) → tranca → contagem → voo → resultado quando o último bate →
// fecha. SOZINHO também é uma sala (só a pessoa, larga na hora): é ela que
// mede a prática (o aparelho não diz quanto jogou).
//
// A sala só repassa as poses (~20 Hz), recusa o impossível (andar mais do que
// a velocidade máxima, sair do túnel) e monta a classificação pela distância.
// Quem sai no meio fica com o que tinha ("saiu"). A pessoa continua presente
// no centro (como no Paint/corrida/Rolê).
//
// FASES (mm3d-75): o túnel que a semente gera depende da FASE escolhida
// (features/meu-mundo/jetpack/sim/phases.ts no front). A sala é por fase
// (filterBy centerRoomId + solo + phase) e manda a fase na largada: em grupo
// todos voam a mesma fase com a mesma semente. A física não muda entre fases,
// então os limites daqui (velocidade, caixa do túnel) valem para todas.

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const presence = require("./meuMundoPresence");
const { roomLook } = require("../utils/meuMundoColors");
const { createLogger } = require("../utils/logger");
const { PracticeMeter } = require("./meuMundoPractice");

const log = createLogger("meuMundo.jetpack");

const JETPACK_ROOM = "jetpack";
// Regra do Alex (2026-11-08): o túnel é SEMPRE de 4 — você e mais 3 (pessoas ou computadores).
const SEATS = 4;
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const TICK_MS = 50; // 20 Hz
const MAX_MSG_PER_SEC = 45;
const ABUSE_DROPS = 300;
const COUNTDOWN_S = 3;
/** Fases jogáveis (as mesmas de PLAYABLE_PHASES em sim/phases.ts do front); desconhecida = a original. */
const JETPACK_PHASES = ["industrial", "canion", "orbital", "floresta", "forja", "artico"];
const phaseOf = (p) => (JETPACK_PHASES.includes(p) ? p : JETPACK_PHASES[0]);
/** Túnel (o mesmo de sim/flight.ts): x ∈ [−W/2, W/2], y ∈ [0, H]. */
const TUNNEL = { W: 10, H: 8 };
/**
 * Fator de velocidade pelo ATRIBUTO velocidade do personagem (0–1000): 0,85×
 * até 1,35×. A MESMA conta de speedFactor em sim/flight.ts do front.
 */
function speedFactor(attr) {
  const a = Number.isFinite(Number(attr)) ? Math.max(0, Math.min(1000, Number(attr))) : 0;
  return Math.round((0.85 + 0.5 * (a / 1000)) * 1000) / 1000;
}
/** Mais rápido possível (vMax da regra, 46 m/s × o maior fator) com folga. */
const MAX_V = 46 * 1.35 * 1.25;
/** Pontos: metros + 25 por galão (no máximo um galão a cada ~3 m). */
const CAN_POINTS = 25;
const MAX_RUN_S = 1800;
const SILENT_S = 8;

/** Prazos (a suíte e2e encurta). */
const timing = { lobbyMs: 60000, closeMs: 20000 };

// ── COMPUTADORES (regra do Alex, 2026-11-08) ── sem "sozinho": toda largada espera até 1 minuto
// e as vagas vazias viram computadores, rodados AQUI com a regra gerada do voo.
const { JetpackBot } = require("../utils/meuMundoJetpackBot");
const BOT_NAMES = ["Pipoca", "Jujuba", "Paçoca", "Cocada", "Quindim", "Bolacha", "Brigadeiro", "Pudim", "Canjica", "Suspiro"];
const BOT_BODIES = ["normal", "female", "slim", "strong", "fat", "female", "normal", "slim"];

const JtPlayer = schema(
  {
    slot: t.uint8(),
    name: t.string(),
    online: t.boolean(),
  },
  "JTPlayer"
);

const JtState = schema(
  {
    phase: t.string(), // "lobby" | "countdown" | "run" | "end"
    until: t.float64(),
    time: t.float32(),
    players: t.map(JtPlayer),
    result: t.string(),
  },
  "JTState"
);

/** userId → { room, sessionId } (uma sessão por pessoa entre as salas do jetpack). */
const byUser = new Map();
/** roomId → sala viva. */
const rooms = new Map();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

class JetpackRoom extends Room {
  async onCreate(options) {
    this.centerRoomId = String(options.centerRoomId || "");
    // 2026-11-08: não existe mais sala sozinho (o aparelho antigo que pedir cai na de grupo)
    this.solo = false;
    this.phase = phaseOf(options.phase);
    this.maxClients = this.solo ? 1 : SEATS;
    this.patchRate = 100;
    this.seatReservationTimeout = 15;
    this.setState(new JtState());
    this.state.phase = "lobby";
    this.state.until = Date.now() + (this.solo ? 0 : timing.lobbyMs);
    /** sessionId → { userId, slot, body, look, run, bucket, ... } */
    this.seats = new Map();
    this.startedAt = 0;
    this.closeTimer = null;
    this.meter = null;
    rooms.set(this.roomId, this);
    this.onMessage("p", (client, msg) => this.onPose(client, msg));
    this.onMessage("x", (client, msg) => this.onCrash(client, msg));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval(() => this.loop(), TICK_MS);
    log.info("jetpack.create", { roomId: this.roomId, solo: this.solo, phase: this.phase });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    if (!admin || !sameCenter || this.state.phase !== "lobby") {
      log.warn("jetpack.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao jetpack");
    }
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId);
    const body = MeuMundoStorage.BODIES.includes(options.body) ? options.body : "normal";
    const look = await MeuMundoStorage.getLook(pool, userId).then((l) => roomLook(body, l), () => "");
    const slot = this.freeSlot();
    this.state.players.set(client.sessionId, new JtPlayer({ slot, name: String(options.name || "piloto").slice(0, 24), online: true }));
    const k = speedFactor(options.speed);
    this.seats.set(client.sessionId, { userId, slot, body, look, k, run: null, bucket: MAX_MSG_PER_SEC, lastRefill: Date.now(), drops: 0, dropsSince: Date.now() });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    client.send("welcome", { slot, left: Math.max(0, this.state.until - Date.now()) });
    if (this.solo || this.seats.size >= SEATS) this.start();
    log.info("jetpack.join", { roomId: this.roomId, people: this.seats.size, slot, solo: this.solo });
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (s.run) {
      p.online = false;
      if (s.run.alive) Object.assign(s.run, { alive: false, gone: true, time: this.state.time });
      if (this.meter) this.meter.settle(s.userId);
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

  /** Só o possível: z não volta nem passa da velocidade máxima; dentro do túnel; pontos com teto pela distância. */
  accept(s, msg) {
    const r = s.run;
    const now = Date.now();
    const dt = r.at ? Math.min(3, (now - r.at) / 1000) : 0.5;
    let z = num(msg.z);
    if (!Number.isFinite(z)) return false;
    z = Math.max(r.z - 2, Math.min(r.z + MAX_V * dt + 20, z));
    r.z = Math.max(0, z);
    r.at = now;
    const x = num(msg.x);
    const y = num(msg.y);
    r.x = Number.isFinite(x) ? Math.max(-TUNNEL.W / 2, Math.min(TUNNEL.W / 2, x)) : r.x;
    r.y = Number.isFinite(y) ? Math.max(0, Math.min(TUNNEL.H, y)) : r.y;
    r.f = Math.max(0, Math.min(255, Math.floor(num(msg.f) || 0)));
    const cans = Math.max(0, Math.floor(num(msg.c) || 0));
    r.cans = Math.max(r.cans, Math.min(cans, Math.floor(r.z / 3)));
    const sc = Math.floor(num(msg.s) || 0);
    r.score = Math.max(r.score, Math.min(sc, Math.floor(r.z) + r.cans * CAN_POINTS));
    return true;
  }

  // ── mensagens ──────────────────────────────────────────────────────────────

  onPose(client, msg) {
    const s = this.running(client);
    if (!s || !msg) return;
    this.accept(s, msg);
    if (this.meter) this.meter.pose(s.userId, msg);
  }

  /** Bateu (o aparelho manda o fim: distância, pontos, galões e no que bateu). */
  onCrash(client, msg) {
    const s = this.running(client);
    if (!s || !msg) return;
    this.accept(s, msg);
    s.run.alive = false;
    s.run.by = typeof msg.by === "string" ? msg.by.slice(0, 12) : "";
    s.run.time = this.state.time;
    log.info("jetpack.crash", { roomId: this.roomId, slot: s.slot, dist: Math.floor(s.run.z) });
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
    // vagas vazias = computadores (nome de doce, corpo variado, velocidade e habilidade sorteadas)
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    this.bots = [];
    for (let i = 0; this.seats.size + this.bots.length < SEATS; i++) {
      const used = new Set([...this.seats.values()].map((x) => x.slot).concat(this.bots.map((b) => b.slot)));
      let slot = 0;
      while (used.has(slot)) slot++;
      const k = Math.round((0.9 + Math.random() * 0.3) * 1000) / 1000;
      const bot = new JetpackBot({ seed, phase: this.phase, k, skill: 0.2 + Math.random() * 0.7, luck: (Math.random() * 0x7fffffff) | 1 });
      this.bots.push({ slot, name: names[i % names.length], body: BOT_BODIES[i % BOT_BODIES.length], k, bot, run: { z: 0, x: 0, y: 4, f: 0, score: 0, cans: 0, alive: true, gone: false, by: "", time: 0 } });
    }
    const seats = [...this.seats.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((s) => {
        const p = [...this.state.players.values()].find((q) => q.slot === s.slot);
        s.run = { z: 0, x: 0, y: 4, f: 0, score: 0, cans: 0, alive: true, gone: false, by: "", time: 0, at: 0 };
        return { slot: s.slot, name: p ? p.name : "", body: s.body, look: s.look, k: s.k };
      })
      .concat(this.bots.map((b) => ({ slot: b.slot, name: b.name, body: b.body, look: "", k: b.k, bot: true })))
      .sort((a, b) => a.slot - b.slot);
    this.startedAt = Date.now();
    // prática medida pela sala (quem bateu não manda pose = não conta)
    this.meter = new PracticeMeter("jetpack", `jetpack:${this.roomId}:${this.startedAt}`, log);
    this.state.phase = "countdown";
    this.state.time = -COUNTDOWN_S;
    this.state.until = 0;
    void this.lock();
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (s) client.send("start", { me: s.slot, seed, countdown: COUNTDOWN_S, seats, solo: this.solo, phase: this.phase });
    }
    log.info("jetpack.start", { roomId: this.roomId, people: seats.length, solo: this.solo, phase: this.phase });
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
      const since = r.at || this.startedAt + COUNTDOWN_S * 1000;
      if (r.alive && now - since > SILENT_S * 1000) Object.assign(r, { alive: false, gone: true, time: this.state.time });
    }
    // os computadores voam no relógio da sala
    for (const b of this.bots || []) {
      if (!b.run.alive) continue;
      b.bot.advance(TICK_MS / 1000);
      const p = b.bot.pose();
      Object.assign(b.run, { z: p.z, x: p.x, y: p.y, f: p.f, score: p.score, cans: p.cans });
      if (!p.alive) Object.assign(b.run, { alive: false, by: String(p.by).slice(0, 12), time: this.state.time });
    }
    this.snapshot();
    const anyAlive = [...this.seats.values()].some((s) => s.run.alive);
    if (!anyAlive || this.state.time > MAX_RUN_S) this.finish();
  }

  /** Todos a 20 Hz: [slot, z, x, y, bandeiras, pontos, vivo] por pessoa. */
  snapshot() {
    const c = [];
    for (const s of [...this.seats.values(), ...(this.bots || [])]) {
      const r = s.run;
      c.push(s.slot, r2(r.z), r3(r.x), r3(r.y), r.f, r.score, r.alive ? 1 : r.gone ? 2 : 0);
    }
    this.broadcast("s", { t: r3(this.state.time), c });
  }

  finish() {
    if (this.meter) {
      // vitória = quem foi mais longe no túnel (contando os computadores), se for uma pessoa
      const best = [...this.seats.values(), ...(this.bots || [])].filter((s) => s.run).sort((a, b) => b.run.z - a.run.z)[0];
      this.meter.settle(null, new Set(best && best.userId ? [best.userId] : []));
    }
    const rows = [...this.seats.values()]
      .map((s) => {
        const p = [...this.state.players.values()].find((q) => q.slot === s.slot);
        return { slot: s.slot, name: p ? p.name : "", score: s.run.score, dist: Math.floor(s.run.z), cans: s.run.cans, by: s.run.by, gone: s.run.gone };
      })
      .concat((this.bots || []).map((b) => ({ slot: b.slot, name: b.name, score: b.run.score, dist: Math.floor(b.run.z), cans: b.run.cans, by: b.run.by, gone: false, bot: true })))
      .sort((a, b) => b.dist - a.dist || b.score - a.score);
    this.state.result = JSON.stringify({ rows, phase: this.phase });
    this.state.phase = "end";
    this.state.until = Date.now() + timing.closeMs;
    log.info("jetpack.end", { roomId: this.roomId, people: rows.length, best: rows[0] ? rows[0].dist : 0, phase: this.phase });
    this.closeTimer = this.clock.setTimeout(() => this.disconnect(), timing.closeMs);
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(JETPACK_ROOM, JetpackRoom).filterBy(["centerRoomId", "solo", "phase"]).sortBy({ clients: -1 });
  ready = true;
}

/** Reserva o lugar (quem chama já conferiu papel, centro e porta). `solo` = sala só da pessoa, larga na hora; `phase` = a fase. */
async function reserveJetpackSeat({ userId, name, body, centerRoomId, solo = false, speed = 0, phase }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  // 2026-11-08: sem sala sozinho — todo mundo na largada em grupo da fase (computadores completam)
  void solo;
  const options = { centerRoomId, userId, name, body, solo: false, speed: Number(speed) || 0, phase: phaseOf(phase) };
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(JETPACK_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation|locked/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro (voltou para casa): sai do jetpack também. */
function leaveJetpack(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId);
}

async function jetpackStatus() {
  const list = await matchMaker.query({ name: JETPACK_ROOM });
  return { jetpackRooms: list.length, jetpackClients: list.reduce((n, r) => n + (r.clients || 0), 0) };
}

module.exports = {
  define,
  reserveJetpackSeat,
  leaveJetpack,
  jetpackStatus,
  JETPACK_ROOM,
  JETPACK_PHASES,
  SEATS,
  speedFactor,
  phaseOf,
  // só para a suíte e2e
  _jetpackRooms: () => [...rooms.values()],
  _jetpackTiming: timing,
};
