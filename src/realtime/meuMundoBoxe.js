// src/realtime/meuMundoBoxe.js — MEU MUNDO 3D: Arena de Boxe (mm3d-43)
//
// Pedido do Alex: "dá para lutar sozinho contra o computador; no multiplayer
// você entra com outro usuário, mas não controla o personagem — conta
// velocidade, força, treino, alimentado, descansado; você calcula e deixa eles
// brigando, e o usuário assiste; se perder por muito pode ir para o hospital".
//
// Uma sala por luta, do MESMO centro:
//  • "solo": uma pessoa, larga na hora contra o computador que ela escolheu
//    (mais fraco / parelho / mais forte — o mesmo que viu na ficha, pela
//    semente guardada em previewCpu).
//  • "mp": duas pessoas; espera até LOBBY_MS desde que abriu; ninguém veio =
//    luta contra o computador parelho (o aparelho avisa).
// Na largada a sala lê a VIDA de cada um (MeuMundoLifeService.fighter),
// calcula a luta INTEIRA (src/utils/meuMundoBoxe.js) e manda a linha do tempo;
// os aparelhos só desenham. A sala segue o relógio: quem joga a TOALHA perde
// ali (a luta para para os dois). No fim, cada pessoa recebe a consequência na
// vida (MeuMundoLifeService.fightAftermath) — mesmo quem fechou a aba: a sala
// não se desfaz sozinha durante a luta (autoDispose desligado).
//
// A pessoa continua presente no centro (como no jetpack/Paint/corrida/Rolê).

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoLifeService = require("../services/MeuMundoLifeService");
const presence = require("./meuMundoPresence");
const Boxe = require("../utils/meuMundoBoxe");
const { PALETTE, roomLook } = require("../utils/meuMundoColors");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.boxe");

const BOXE_ROOM = "boxe";
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const TICK_MS = 100;
const MAX_MSG_PER_SEC = 10;
/** Entrada no ringue e apresentação antes do 1º sino (s): o aparelho anima. */
const INTRO_S = 5;
/** Bolsa da vitória no multiplayer (contra gente). */
const MP_PURSE = 60;
/** A ficha do computador vale por este tempo (a luta escolhida é a que foi vista). */
const PREVIEW_MS = 15 * 60 * 1000;

/** Prazos (a suíte e2e encurta; `speed` acelera o relógio da luta). */
const timing = { lobbyMs: 60000, closeMs: 20000, soloDelayMs: 600, introS: INTRO_S, speed: 1 };

/** Apelidos do computador (nomes de ringue originais). */
const CPU_NAMES = ["Tufão", "Marreta", "Raio Moreno", "Zé Pedrada", "Canhota", "Trovão", "Sombra", "Paredão", "Cascavel", "Martelo", "Bigorna", "Furacão", "Tatu", "Faísca", "Rochedo", "Leão do Morro"];

const BxPlayer = schema(
  {
    slot: t.uint8(), // 0 = canto vermelho, 1 = canto azul
    name: t.string(),
    online: t.boolean(),
    cpu: t.boolean(),
  },
  "BXPlayer"
);

const BxState = schema(
  {
    phase: t.string(), // "lobby" | "fight" | "end"
    until: t.float64(), // ms (epoch): fim da espera ou fechamento depois do fim
    time: t.float32(), // s no relógio da luta (negativo na apresentação)
    players: t.map(BxPlayer),
  },
  "BXState"
);

/** userId → { room, sessionId } (uma luta por pessoa). */
const byUser = new Map();
/** userId → { seed, at }: a semente dos adversários mostrados na ficha. */
const previews = new Map();
const rooms = new Map();

const STRATS = Object.keys(Boxe.STRATEGIES);
const TIER_IDS = Object.keys(Boxe.TIERS);

/** Os três adversários do computador para os números do jogador (semente da pessoa). */
function cpuOpponents(stats, seed) {
  return TIER_IDS.map((tier, i) => cpuFighter(stats, tier, (seed + i * 7919) >>> 0));
}

/** Um adversário do computador: números, nome, corpo e cores (tudo pela semente). */
function cpuFighter(stats, tier, seed) {
  const r = Boxe.rng(seed);
  const s = Boxe.cpuStats(stats, tier, seed);
  const body = s.strength > 450 || r() < 0.35 ? "strong" : r() < 0.3 ? "slim" : "normal";
  const pick = (k) => Math.floor(r() * PALETTE[k].length).toString(36);
  const look = roomLook(body, pick("shirt") + pick("pants") + pick("skin") + pick("hair"));
  const name = CPU_NAMES[Math.floor(r() * CPU_NAMES.length)];
  return { tier, name, body, look, stats: s, view: Boxe.fighter(s).view, purse: Boxe.TIERS[tier].purse };
}

class BoxeRoom extends Room {
  async onCreate(options) {
    this.centerRoomId = String(options.centerRoomId || "");
    this.mode = options.mode === "mp" ? "mp" : "solo";
    this.maxClients = this.mode === "mp" ? 2 : 1;
    this.patchRate = 200;
    this.seatReservationTimeout = 15;
    this.setState(new BxState());
    this.state.phase = "lobby";
    this.state.until = this.mode === "mp" ? Date.now() + timing.lobbyMs : 0;
    /** sessionId → { userId, slot, name, strategy, tier, fighter, bucket, lastRefill } */
    this.seats = new Map();
    this.fight = null;
    this.corners = null; // [{ userId|null, name, body, look, cpu, strategy, purse }]
    this.startedAt = 0;
    this.towel = null; // { who, at }
    this.applied = false;
    this.closeTimer = null;
    rooms.set(this.roomId, this);
    this.onMessage("towel", (client) => this.onTowel(client));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval(() => this.loop(), TICK_MS);
    log.info("boxe.create", { roomId: this.roomId, mode: this.mode });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    if (!admin || !sameCenter || this.state.phase !== "lobby") {
      log.warn("boxe.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado à arena");
    }
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId);
    const slot = this.seats.size === 0 ? 0 : [...this.seats.values()][0].slot === 0 ? 1 : 0;
    const name = String(options.name || "lutador").slice(0, 24);
    const strategy = STRATS.includes(options.strategy) ? options.strategy : "balanced";
    const tier = TIER_IDS.includes(options.tier) ? options.tier : "even";
    this.state.players.set(client.sessionId, new BxPlayer({ slot, name, online: true, cpu: false }));
    this.seats.set(client.sessionId, { userId, slot, name, strategy, tier, bucket: MAX_MSG_PER_SEC, lastRefill: Date.now() });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    client.send("welcome", { slot, mode: this.mode, left: this.mode === "mp" ? Math.max(0, this.state.until - Date.now()) : 0 });
    log.info("boxe.join", { roomId: this.roomId, people: this.seats.size, slot });
    if (this.mode === "solo") this.clock.setTimeout(() => this.start(), timing.soloDelayMs);
    else if (this.seats.size >= 2) this.start();
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (this.fight) {
      // Na luta: ela segue (e a consequência vale) — só some da tela.
      p.online = false;
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

  replace(sessionId) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      client.send("replaced", {});
      client.leave(CLOSE.REPLACED);
    } else if (!this.fight) {
      this.seats.delete(sessionId);
      this.state.players.delete(sessionId);
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
    return false;
  }

  // ── mensagens ──────────────────────────────────────────────────────────────

  /** Jogar a toalha: quem joga perde agora e a luta para para os dois. */
  onTowel(client) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.fight || this.towel || this.state.phase !== "fight" || !this.takeToken(client, s)) return;
    const at = Math.max(0, Math.round(this.state.time * 100) / 100);
    if (at >= this.fight.result.t) return;
    this.towel = { who: s.slot, at };
    this.broadcast("towel", { who: s.slot, at });
    log.info("boxe.towel", { roomId: this.roomId, slot: s.slot, at });
  }

  onPing(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.takeToken(client, s)) return;
    client.send("pong", { c: Number(msg && msg.c) || 0, t: this.state.time });
  }

  // ── luta ───────────────────────────────────────────────────────────────────

  async start() {
    if (this.startedAt || !this.seats.size) return;
    this.startedAt = -1; // largando (a leitura da vida é assíncrona)
    void this.lock();
    const seats = [...this.seats.values()].sort((a, b) => a.slot - b.slot);
    const seed = (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0;
    const corners = [null, null];
    let nobody = false;
    for (const s of seats) {
      let f = null;
      try {
        f = await MeuMundoLifeService.fighter(s.userId);
      } catch (err) {
        log.error("boxe.fighter_fail", { message: err.message });
      }
      // Sem a vida (falha) luta com números neutros; a consequência ainda tenta valer.
      const stats = f ? f.stats : Boxe.cpuStats({ strength: 30, speed: 30 }, "even", seed);
      corners[s.slot] = {
        userId: s.userId,
        name: s.name,
        body: f ? f.body : "normal",
        look: f ? roomLook(f.body, f.look) : "",
        cpu: false,
        strategy: s.strategy,
        stats,
        record: f ? f.boxing : null,
        tier: s.tier,
      };
    }
    if (!corners[0] || !corners[1]) {
      // computador: o escolhido (solo) ou o parelho (multiplayer sem ninguém)
      const human = corners[0] || corners[1];
      const humanSeat = seats[0];
      const tier = this.mode === "solo" ? humanSeat.tier : "even";
      nobody = this.mode === "mp";
      const pv = previews.get(human.userId);
      const pseed = pv && Date.now() - pv.at < PREVIEW_MS ? pv.seed : seed;
      const cpu = cpuFighter(human.stats, tier, (pseed + TIER_IDS.indexOf(tier) * 7919) >>> 0);
      const slot = corners[0] ? 1 : 0;
      corners[slot] = { userId: null, name: cpu.name, body: cpu.body, look: cpu.look, cpu: true, strategy: "balanced", stats: cpu.stats, record: null, tier };
      this.state.players.set(`cpu${slot}`, new BxPlayer({ slot, name: cpu.name, online: true, cpu: true }));
      human.purse = cpu.purse;
    } else {
      corners[0].purse = MP_PURSE;
      corners[1].purse = MP_PURSE;
    }
    if (this.seats.size === 0) {
      // todo mundo saiu enquanto lia a vida
      this.disconnect();
      return;
    }
    this.corners = corners;
    this.fight = Boxe.simulate({ stats: corners[0].stats, strategy: corners[0].strategy }, { stats: corners[1].stats, strategy: corners[1].strategy }, seed);
    this.autoDispose = false;
    this.startedAt = Date.now();
    this.state.phase = "fight";
    this.state.time = -timing.introS;
    this.state.until = 0;
    const pub = corners.map((c, i) => ({
      slot: i,
      name: c.name,
      body: c.body,
      look: c.look,
      cpu: c.cpu,
      strategy: c.strategy,
      record: c.record,
      view: this.fight.view[i],
    }));
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (s) client.send("start", { me: s.slot, nobody, intro: timing.introS, corners: pub, fight: this.fight });
    }
    log.info("boxe.start", { roomId: this.roomId, mode: this.mode, cpu: corners.some((c) => c.cpu), method: this.fight.result.method });
  }

  loop() {
    if (this.startedAt === 0) {
      if (this.mode === "mp" && this.state.phase === "lobby" && Date.now() >= this.state.until && this.seats.size > 0) void this.start();
      return;
    }
    if (this.startedAt < 0 || this.state.phase !== "fight") return;
    this.state.time = ((Date.now() - this.startedAt) / 1000) * timing.speed - timing.introS;
    const end = this.towel ? this.towel.at + 2.5 : this.fight.result.t + 1.5;
    if (this.state.time >= end && !this.applied) void this.finish();
  }

  async finish() {
    this.applied = true;
    const cut = this.towel ? this.towel.at : Infinity;
    const towelWho = this.towel ? this.towel.who : null;
    const out = [];
    for (let i = 0; i < 2; i++) {
      const c = this.corners[i];
      const sum = Boxe.summary(this.fight, i, cut, towelWho);
      out[i] = { slot: i, ...sum };
      if (!c.userId) continue;
      try {
        out[i].aftermath = await MeuMundoLifeService.fightAftermath(c.userId, { ...sum, purse: sum.outcome === "win" ? c.purse : 0 });
      } catch (err) {
        log.error("boxe.aftermath_fail", { message: err.message });
        out[i].aftermath = null;
      }
    }
    this.state.phase = "end";
    this.state.until = Date.now() + timing.closeMs;
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (!s) continue;
      const mine = out[s.slot];
      client.send("result", { me: s.slot, towel: this.towel, rows: out.map(({ aftermath, ...r }) => r), aftermath: mine.aftermath || null });
    }
    log.info("boxe.end", { roomId: this.roomId, method: this.towel ? "towel" : this.fight.result.method });
    this.closeTimer = this.clock.setTimeout(() => this.disconnect(), timing.closeMs);
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(BOXE_ROOM, BoxeRoom).filterBy(["centerRoomId", "mode"]).sortBy({ clients: -1 });
  ready = true;
}

/**
 * Ficha para a tela: os três do computador (a semente fica guardada para a
 * luta escolhida ser a vista). `stats` = Life.fightStats da pessoa.
 */
function previewCpu(userId, stats) {
  let pv = previews.get(userId);
  if (!pv || Date.now() - pv.at > PREVIEW_MS) {
    pv = { seed: (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0, at: Date.now() };
    previews.set(userId, pv);
  }
  return cpuOpponents(stats, pv.seed).map(({ stats: _s, ...pub }) => pub);
}

/** Reserva o lugar (quem chama já conferiu papel, centro, porta e a vida). */
async function reserveBoxeSeat({ userId, name, centerRoomId, mode, tier, strategy }) {
  if (!ready) throw Object.assign(new Error("arena indisponível"), { statusCode: 503 });
  const options = { centerRoomId, userId, name, mode: mode === "mp" ? "mp" : "solo", tier, strategy };
  if (options.mode === "solo") return matchMaker.create(BOXE_ROOM, options);
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(BOXE_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation|locked/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro: sai da espera (a luta em andamento segue e vale). */
function leaveBoxe(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId);
}

/** Está numa luta agora? (uma por vez). */
const inBoxe = (userId) => {
  const mine = byUser.get(userId);
  return !!(mine && mine.room.fight && mine.room.state.phase === "fight");
};

async function boxeStatus() {
  const list = await matchMaker.query({ name: BOXE_ROOM });
  return { boxeRooms: list.length, boxeClients: list.reduce((n, r) => n + (r.clients || 0), 0) };
}

module.exports = {
  define,
  reserveBoxeSeat,
  previewCpu,
  leaveBoxe,
  inBoxe,
  boxeStatus,
  BOXE_ROOM,
  // só para a suíte e2e
  _boxeRooms: () => [...rooms.values()],
  _boxeTiming: timing,
};
