// src/realtime/meuMundoJetpack.js — MEU MUNDO 3D: jetpack em grupo (mm3d-21)
//
// Uma sala por grupo de até 4 pessoas do MESMO centro (filterBy centerRoomId,
// a mais cheia primeiro). Quem entra cai na JANELA DE ESPERA: "Começar" deixa
// pronto; "Entrar sozinho" é do cliente (sai da sala e joga o single-player
// local). A partida em grupo (2 a 4) começa quando todos os presentes estão
// prontos, ou PARTY.lobbyMs depois de o 2º chegar com ≥ 2 prontos — sozinho na
// espera nunca começa sozinho. Contagem → a sala tranca → corrida → resultados
// → de volta à espera (revanche na mesma sala).
//
// O servidor é a autoridade: roda a MESMA simulação do navegador
// (utils/meuMundoJetpack.js, gerado do TS) a 120 Hz. O cliente manda só a
// mudança de "segurando" com o passo em que ela aconteceu nele; chegando
// antes, vale no mesmo passo aqui (a sim é determinística, então o que ele viu
// é o que acontece); atrasada, vale no passo atual.
//
// A pessoa continua presente no centro (o avatar fica parado na porta): esta
// sala NÃO toma a presença. Uma sessão por usuário entre todas as salas do
// jetpack (a nova substitui a antiga).

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const crypto = require("crypto");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const presence = require("./meuMundoPresence");
const { Match, PARTY, TUNING } = require("../utils/meuMundoJetpack");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.jetpack");

const JETPACK_ROOM = "jetpack";
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const SIM_MS = 25; // 3 passos de 1/120 s por volta
const PATCH_MS = 50; // 20 Hz de estado
const MAX_MSG_PER_SEC = 30;
const ABUSE_DROPS = 200;
/** Janela aceita para o passo de uma entrada: até 1 s atrasada, até 0,5 s adiantada. */
const INPUT_LATE = 120;
const INPUT_EARLY = 60;
/** Estado do jogador como número (cliente e servidor). */
const STATE_CODE = { ready: 0, flying: 1, falling: 2, out_of_fuel: 3, dead: 4 };

/** Prazos (a suíte e2e encurta). */
const timing = {
  lobbyMs: PARTY.lobbyMs,
  countdownMs: PARTY.countdownMs,
  resultsMs: PARTY.resultsMs,
  emptyMs: 0,
};

const JpRunner = schema(
  {
    slot: t.uint8(),
    name: t.string(),
    body: t.string(),
    ready: t.boolean(),
    inMatch: t.boolean(),
    online: t.boolean(),
    // estado da sim (precisão total: o cliente restaura daqui)
    st: t.uint8(),
    x: t.float64(),
    y: t.float64(),
    vy: t.float64(),
    fuel: t.float64(),
    held: t.boolean(),
    thr: t.boolean(),
    pw: t.float64(), // fim do turbo (s de jogo)
    pf: t.boolean(), // turbo ainda não avisado como acabado
    tow: t.boolean(),
    grace: t.float64(),
    pid: t.uint32(), // maior id de obstáculo ultrapassado
    pass: t.uint16(),
    ph: t.uint8(),
    fc: t.float64(), // combustível coletado
    got: t.uint16(), // cápsulas
    sm: t.uint16(), // peças quebradas
    dieAt: t.uint32(),
    place: t.uint8(),
  },
  "JPRunner"
);

const JpState = schema(
  {
    phase: t.string(), // "lobby" | "countdown" | "running" | "results"
    seed: t.uint32(),
    tick: t.uint32(), // passo da partida a que os valores dos jogadores se referem
    until: t.float64(), // ms (epoch): fim da espera em grupo / da contagem / dos resultados (0 = sem prazo)
    runners: t.map(JpRunner),
    taken: t.map("uint8"), // id da cápsula → vaga de quem pegou
    broken: t.map("uint8"), // id do obstáculo → peças quebradas (bits)
    vulcans: t.array("float64"),
  },
  "JPState"
);

/** userId → { room, sessionId } (uma sessão por pessoa em todas as salas do jetpack). */
const byUser = new Map();
/** roomId → sala viva. */
const rooms = new Map();

class JetpackRoom extends Room {
  async onCreate(options) {
    this.centerRoomId = String(options.centerRoomId || "");
    this.maxClients = PARTY.max;
    this.patchRate = PATCH_MS;
    this.seatReservationTimeout = 15;
    this.setState(new JpState());
    this.state.phase = "lobby";
    /** sessionId → { userId, slot, bucket... , inputs: [{k,h}], held } */
    this.sim = new Map();
    this.match = null;
    this.acc = 0;
    /** Quando o 2º chegou à espera (prazo do grupo). */
    this.groupSince = 0;
    this.phaseTimer = null;
    rooms.set(this.roomId, this);
    this.onMessage("ready", (client, msg) => this.onReady(client, msg));
    this.onMessage("h", (client, msg) => this.onInput(client, msg));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval((dt) => this.loop(dt), SIM_MS);
    log.info("jetpack.create", { roomId: this.roomId });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    const back = this.runnerOf(userId);
    if (!admin || !sameCenter || (this.state.phase !== "lobby" && !back)) {
      log.warn("jetpack.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao jetpack");
    }
    // Uma sessão por pessoa: a anterior (outra aba, outra sala) sai.
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId, prev.room === this);
    let slot;
    if (back) {
      // Volta (reconexão / outra aba): o mesmo jogador, na mesma vaga.
      slot = back.s.slot;
      this.sim.delete(back.sid);
      const r = this.state.runners.get(back.sid);
      this.state.runners.delete(back.sid);
      r.online = true;
      this.state.runners.set(client.sessionId, r);
    } else {
      slot = this.freeSlot();
      const r = new JpRunner({
        slot,
        name: String(options.name || "morador").slice(0, 24),
        body: String(options.body || "normal").slice(0, 16),
        ready: false,
        inMatch: false,
        online: true,
      });
      this.state.runners.set(client.sessionId, r);
    }
    this.sim.set(client.sessionId, {
      userId,
      slot,
      inputs: back ? back.s.inputs : [],
      held: back ? back.s.held : false,
      bucket: MAX_MSG_PER_SEC,
      lastRefill: Date.now(),
      drops: 0,
      dropsSince: Date.now(),
    });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    client.send("welcome", { slot, step: TUNING.step });
    this.lobbyCheck();
    log.info("jetpack.join", { roomId: this.roomId, people: this.sim.size, slot, back: !!back });
  }

  onLeave(client) {
    const s = this.sim.get(client.sessionId);
    const r = this.state.runners.get(client.sessionId);
    if (!s || !r) {
      // Sessão já substituída (outra aba voltou no lugar dela).
      this.syncLock();
      return;
    }
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (this.match && r.inMatch && (this.state.phase === "running" || this.state.phase === "countdown")) {
      // Na partida: o jogador fica (solto, ele cai); pode voltar pela reserva.
      r.online = false;
      s.held = false;
      s.inputs.length = 0;
      return;
    }
    this.sim.delete(client.sessionId);
    this.state.runners.delete(client.sessionId);
    this.syncLock();
    this.lobbyCheck();
  }

  onDispose() {
    rooms.delete(this.roomId);
    for (const s of this.sim.values()) {
      const mine = byUser.get(s.userId);
      if (mine && mine.room === this) byUser.delete(s.userId);
    }
    if (this.phaseTimer) this.phaseTimer.clear();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  runnerOf(userId) {
    for (const [sid, s] of this.sim) if (s.userId === userId) return { sid, s };
    return null;
  }

  freeSlot() {
    const used = new Set([...this.sim.values()].map((s) => s.slot));
    for (let i = 0; i < PARTY.max; i++) if (!used.has(i)) return i;
    return 0;
  }

  /**
   * A trava é só explícita: tranca na contagem e destrava na espera quando há
   * vaga (a trava automática do Colyseus não volta sozinha depois de lock()).
   */
  syncLock() {
    if (this.state.phase === "lobby" && this.locked && !this.hasReachedMaxClients()) void this.unlock();
  }

  /**
   * Volta (outra aba, reconexão): a vaga é a mesma, então passa do limite só
   * nesta reserva, com a sala trancada para ninguém entrar no meio. A sessão
   * antiga sai no onJoin.
   */
  async reserveBack(options) {
    await this.lock();
    this.maxClients = PARTY.max + 1;
    try {
      return await matchMaker.reserveSeatFor(this._listing, options).catch(() => null);
    } finally {
      this.maxClients = PARTY.max;
      this.syncLock();
    }
  }

  /** Outra sessão da mesma pessoa assumiu: avisa e derruba esta. */
  replace(sessionId, sameRoom) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!sameRoom) {
      // Mudou de sala: o jogador some daqui (na corrida, cai).
      const r = this.state.runners.get(sessionId);
      const s = this.sim.get(sessionId);
      if (r && s && this.match && r.inMatch && this.state.phase === "running") {
        r.online = false;
        s.held = false;
      } else {
        this.sim.delete(sessionId);
        this.state.runners.delete(sessionId);
      }
    }
    if (client) {
      client.send("replaced", {});
      client.leave(CLOSE.REPLACED);
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

  // ── mensagens ──────────────────────────────────────────────────────────────

  onReady(client, msg) {
    const s = this.sim.get(client.sessionId);
    const r = this.state.runners.get(client.sessionId);
    if (!s || !r || !this.takeToken(client, s)) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "results") return;
    r.ready = !!(msg && msg.r);
    this.lobbyCheck();
  }

  onInput(client, msg) {
    const s = this.sim.get(client.sessionId);
    if (!s || !this.takeToken(client, s) || !this.match || this.state.phase !== "running") return;
    const T = this.match.ticks + 1;
    const k = Math.floor(Number(msg && msg.k));
    if (!Number.isFinite(k) || k < T - INPUT_LATE || k > T + INPUT_EARLY) return;
    s.inputs.push({ k: Math.max(k, T), h: !!(msg && msg.h) });
    if (s.inputs.length > 64) s.inputs.splice(0, s.inputs.length - 64);
  }

  onPing(client, msg) {
    const s = this.sim.get(client.sessionId);
    if (!s || !this.takeToken(client, s)) return;
    client.send("pong", { c: Number(msg && msg.c) || 0, k: this.match ? this.match.ticks : 0 });
  }

  // ── espera e contagem ──────────────────────────────────────────────────────

  /** Regra da espera (lobby/resultados) depois de qualquer mudança. */
  lobbyCheck() {
    if (this.state.phase !== "lobby") return;
    const people = [...this.state.runners.values()];
    const ready = people.filter((r) => r.ready).length;
    if (people.length < 2) {
      this.groupSince = 0;
      this.state.until = 0;
      return;
    }
    if (!this.groupSince) {
      this.groupSince = Date.now();
      this.state.until = this.groupSince + timing.lobbyMs;
    }
    if (ready === people.length || (ready >= 2 && Date.now() >= this.state.until)) this.beginCountdown();
  }

  beginCountdown() {
    const slots = [];
    for (const [sid, r] of this.state.runners) {
      r.inMatch = r.ready;
      if (r.inMatch) slots.push(r.slot);
      const s = this.sim.get(sid);
      if (s) {
        s.inputs.length = 0;
        s.held = false;
      }
    }
    const seed = crypto.randomBytes(4).readUInt32LE(0) || 1;
    this.match = new Match(seed, slots, TUNING);
    this.acc = 0;
    this.state.seed = seed;
    this.state.tick = 0;
    this.state.taken.clear();
    this.state.broken.clear();
    this.state.vulcans.clear();
    for (const r of this.state.runners.values()) {
      r.place = 0;
      r.dieAt = 0;
    }
    this.mirror();
    this.state.phase = "countdown";
    this.state.until = Date.now() + timing.countdownMs;
    void this.lock();
    this.after(timing.countdownMs, () => this.beginRun());
    log.info("jetpack.countdown", { roomId: this.roomId, players: slots.length });
  }

  beginRun() {
    if (!this.match) return;
    this.match.start();
    this.state.phase = "running";
    this.state.until = 0;
    this.acc = 0;
  }

  after(ms, fn) {
    if (this.phaseTimer) this.phaseTimer.clear();
    this.phaseTimer = this.clock.setTimeout(() => {
      this.phaseTimer = null;
      fn();
    }, ms);
  }

  // ── corrida ────────────────────────────────────────────────────────────────

  loop(dtMs) {
    if (this.state.phase === "lobby") {
      if (this.state.until && Date.now() >= this.state.until) this.lobbyCheck();
      return;
    }
    if (this.state.phase !== "running" || !this.match) return;
    this.acc += dtMs / 1000;
    const stepS = TUNING.step;
    let n = 0;
    const held = [false, false, false, false];
    while (this.acc >= stepS && n < 12) {
      this.acc -= stepS;
      n++;
      const T = this.match.ticks + 1;
      for (const s of this.sim.values()) {
        // aplica, em ordem, as mudanças marcadas até este passo
        while (s.inputs.length && s.inputs[0].k <= T) s.held = s.inputs.shift().h;
        held[s.slot] = s.held;
      }
      this.match.step(held);
      for (const e of this.match.drain()) {
        if (e.type === "pickup") this.state.taken.set(String(e.id), e.slot);
        else if (e.type === "smash") this.state.broken.set(String(e.obstacle), (this.state.broken.get(String(e.obstacle)) || 0) | (1 << e.piece));
        else if (e.type === "dead") log.info("jetpack.dead", { roomId: this.roomId, slot: e.slot, cause: e.cause, tick: this.match.ticks });
      }
      if (!this.match.aliveCount()) break;
    }
    if (n === 12) this.acc = 0; // servidor engasgou: não acumula atraso
    this.mirror();
    if (!this.match.aliveCount()) this.finish();
  }

  /** Estado da partida → schema (valores do passo `tick`). */
  mirror() {
    const m = this.match;
    if (!m) return;
    this.state.tick = m.ticks;
    for (const [sid, r] of this.state.runners) {
      const run = r.inMatch ? m.runners[r.slot] : null;
      if (!run) continue;
      const s = this.sim.get(sid);
      r.st = STATE_CODE[run.state];
      r.x = run.x;
      r.y = run.y;
      r.vy = run.vy;
      r.fuel = run.fuel.value;
      r.held = !!(s && s.held);
      r.thr = run.thrusting;
      r.pw = run.powerUntil;
      r.pf = run.snapshot().powered;
      r.tow = run.towed;
      r.grace = run.graceUntil;
      r.pid = run.passedId;
      r.pass = run.passed;
      r.ph = run.phase;
      r.fc = run.fuelCollected;
      r.got = run.pickupsTaken;
      r.sm = run.smashed;
      r.dieAt = run.deathTick;
    }
    // vulcans só cresce na partida
    const v = m.track.vulcans;
    for (let i = this.state.vulcans.length; i < v.length; i++) this.state.vulcans.push(v[i]);
    // poda o que ficou para trás (fora da pista viva)
    if (this.state.taken.size > 24) {
      const live = new Set(m.track.pickups.map((p) => String(p.id)));
      for (const id of [...this.state.taken.keys()]) if (!live.has(id)) this.state.taken.delete(id);
    }
    if (this.state.broken.size > 24) {
      const live = new Set(m.track.obstacles.map((o) => String(o.id)));
      for (const id of [...this.state.broken.keys()]) if (!live.has(id)) this.state.broken.delete(id);
    }
  }

  finish() {
    const places = new Map(this.match.placements().map((p) => [p.slot, p.place]));
    for (const r of this.state.runners.values()) {
      if (r.inMatch) r.place = places.get(r.slot) || 0;
      // "Jogar de novo" apertado nos resultados vale para a próxima espera.
      r.ready = false;
    }
    this.state.phase = "results";
    this.state.until = Date.now() + timing.resultsMs;
    log.info("jetpack.results", { roomId: this.roomId, players: places.size });
    this.after(timing.resultsMs, () => this.backToLobby());
  }

  backToLobby() {
    // Quem caiu durante a partida e não voltou sai agora.
    for (const [sid, r] of [...this.state.runners]) {
      if (!r.online) {
        this.state.runners.delete(sid);
        this.sim.delete(sid);
      }
    }
    for (const r of this.state.runners.values()) r.inMatch = false;
    this.match = null;
    this.state.phase = "lobby";
    this.state.until = 0;
    this.groupSince = 0;
    this.syncLock();
    if (!this.clients.length) this.disconnect();
    else this.lobbyCheck();
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(JETPACK_ROOM, JetpackRoom).filterBy(["centerRoomId"]).sortBy({ clients: -1 });
  ready = true;
}

/**
 * Reserva o lugar na sala do jetpack do centro em que a pessoa está. Quem
 * chama já conferiu papel, centro e porta. `roomId` = estava numa sala há
 * pouco (reconexão): volta para o MESMO jogador, se ainda existir.
 */
async function reserveJetpackSeat({ userId, name, body, centerRoomId, roomId = null }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  const options = { centerRoomId, userId, name, body };
  if (roomId) {
    const room = rooms.get(roomId);
    if (room && room.runnerOf(userId)) {
      const seat = await room.reserveBack(options);
      if (seat) return seat;
    }
  }
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(JETPACK_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro (voltou para casa): sai do jetpack também. */
function leaveJetpack(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId, false);
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
  STATE_CODE,
  // só para a suíte e2e
  _jetpackRooms: () => [...rooms.values()],
  _jetpackTiming: timing,
};
