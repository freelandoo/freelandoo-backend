// src/realtime/meuMundoPaint.js — MEU MUNDO 3D: Paint (mm3d-35)
//
// Uma sala por partida, do MESMO centro e do MESMO modo (filterBy centerRoomId
// + mode, a mais cheia primeiro): treino (1), 1×1 (2), 2×2 (4) ou 3×3 (6).
// Quem entra cai num time (o de menos gente; empate = time 0). Sala cheia →
// contagem (a sala tranca) → partida → fim (resultado no estado) → a sala
// fecha 20 s depois. Treino começa na hora.
//
// O servidor decide o JOGO rodando a regra do navegador (utils/meuMundoPaint.js,
// GERADO do TS): munição, cápsulas, corações, nocaute, tinta, gatinhos, portal,
// chefão, tempo e resultado. O MOVIMENTO é do aparelho: a pose chega a ~15 Hz
// e a regra só recusa o impossível (o aparelho recebe `fix`).
//
// O que fica no estado (schema): jogadores, tinta, gatinhos pegos, cápsulas
// fora, gatinhos por time, portais, vida do chefão — quem chega (ou volta)
// vê o mundo como está. O que é instantâneo vai em `ev` (um pacote por volta):
// rastro do tiro, respingo, dano com o empurrão, nocaute, renascimento,
// gatinho/cápsula pegos (com quem pegou), portal, dano no chefão; `fix` e
// `deny` só para quem interessa.
//
// A pessoa continua presente no centro (como no jetpack): esta sala NÃO toma
// a presença. Uma sessão por usuário entre todas as salas do Paint.

const { Room, ServerError, matchMaker } = require("@colyseus/core");
const { schema, t } = require("@colyseus/schema");
const pool = require("../databases");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const { roomLook } = require("../utils/meuMundoColors");
const AuthStorage = require("../storages/AuthStorage");
const presence = require("./meuMundoPresence");
const { PaintMatch, PAINT_MODES, modeCapacity, modeTeams } = require("../utils/meuMundoPaint");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.paint");

const PAINT_ROOM = "paint";
const CLOSE = { REPLACED: 4009, FORBIDDEN: 4003, ABUSE: 4029 };
const TICK_MS = 50;
const MAX_MSG_PER_SEC = 45;
const ABUSE_DROPS = 300;

/** Prazos (a suíte e2e encurta). */
const timing = { closeMs: 20000 };

const PtPlayer = schema(
  {
    slot: t.uint8(),
    team: t.uint8(),
    sit: t.uint8(),
    name: t.string(),
    body: t.string(),
    // Cores do personagem (mm3d-36): código look; "" = textura original.
    look: t.string(),
    online: t.boolean(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    f: t.float32(),
    g: t.boolean(),
    e: t.uint16(),
    hp: t.uint8(),
    a0: t.uint8(),
    a1: t.uint8(),
    a2: t.uint8(),
    cats: t.uint8(),
    dmg: t.uint16(),
    ko: t.float32(), // nocaute até (s de partida); 0 = de pé
    boss: t.boolean(),
  },
  "PTPlayer"
);

const PtBlob = schema(
  {
    c: t.uint8(),
    x: t.float32(),
    z: t.float32(),
    y0: t.float32(),
    y1: t.float32(),
    r: t.float32(),
    team: t.uint8(),
    owner: t.uint8(),
    q: t.uint32(), // número do tiro no aparelho de quem atirou (troca a prevista)
  },
  "PTBlob"
);

const PtState = schema(
  {
    phase: t.string(), // "lobby" | "countdown" | "play" | "end"
    mode: t.string(),
    until: t.float64(), // ms (epoch): fechamento depois do fim (0 = sem prazo)
    time: t.float32(), // s de partida (negativo na contagem)
    cats: t.map("uint8"), // gatinho → time
    caps: t.map("float32"), // cápsula fora → volta em (s)
    tc0: t.uint8(),
    tc1: t.uint8(),
    p0: t.boolean(),
    p1: t.boolean(),
    bossHp: t.uint16(),
    players: t.map(PtPlayer),
    blobs: t.map(PtBlob),
    result: t.string(), // JSON do resultado (fim)
  },
  "PTState"
);

/** userId → { room, sessionId } (uma sessão por pessoa em todas as salas do Paint). */
const byUser = new Map();
/** roomId → sala viva. */
const rooms = new Map();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const vec = (a) => (Array.isArray(a) && a.length === 3 ? { x: num(a[0]), y: num(a[1]), z: num(a[2]) } : null);
const r3 = (v) => Math.round(v * 1000) / 1000;

class PaintRoom extends Room {
  async onCreate(options) {
    const mode = Object.prototype.hasOwnProperty.call(PAINT_MODES, options.mode) ? options.mode : "solo";
    this.mode = mode;
    this.centerRoomId = String(options.centerRoomId || "");
    this.capacity = modeCapacity(mode);
    this.maxClients = this.capacity;
    this.patchRate = TICK_MS;
    this.seatReservationTimeout = 15;
    this.setState(new PtState());
    this.state.phase = "lobby";
    this.state.mode = mode;
    /** sessionId → { userId, slot, bucket, ... } */
    this.seats = new Map();
    this.match = null;
    this.closeTimer = null;
    rooms.set(this.roomId, this);
    this.onMessage("p", (client, msg) => this.onPose(client, msg));
    this.onMessage("f", (client, msg) => this.onFire(client, msg));
    this.onMessage("u", (client) => this.onPunch(client));
    this.onMessage("ping", (client, msg) => this.onPing(client, msg));
    this.setSimulationInterval((dt) => this.loop(dt), TICK_MS);
    log.info("paint.create", { roomId: this.roomId, mode });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    const body = String(options.body || "normal").slice(0, 16);
    // Cores (mm3d-36): lidas do banco pela conta; falha = textura original.
    const look = await MeuMundoStorage.getLook(pool, userId).then((l) => roomLook(body, l), () => "");
    const here = userId ? presence.get(userId) : null;
    const admin = userId && (await AuthStorage.isAdmin(pool, userId));
    const sameCenter = here && here.scene === "center" && here.id === this.centerRoomId;
    const back = this.seatOf(userId);
    if (!admin || !sameCenter || (this.state.phase !== "lobby" && !back)) {
      log.warn("paint.join_denied", { roomId: this.roomId });
      throw new ServerError(CLOSE.FORBIDDEN, "acesso negado ao Paint");
    }
    const prev = byUser.get(userId);
    if (prev && !(prev.room === this && prev.sessionId === client.sessionId)) prev.room.replace(prev.sessionId, prev.room === this);
    let slot;
    if (back) {
      slot = back.s.slot;
      this.seats.delete(back.sid);
      const p = this.state.players.get(back.sid);
      this.state.players.delete(back.sid);
      p.online = true;
      this.state.players.set(client.sessionId, p);
      if (this.match) this.match.setOnline(slot, true);
    } else {
      slot = this.freeSlot();
      const team = this.pickTeam();
      const sit = [...this.state.players.values()].filter((p) => p.team === team).length;
      const p = new PtPlayer({
        slot,
        team,
        sit,
        name: String(options.name || "morador").slice(0, 24),
        body,
        look,
        online: true,
      });
      this.state.players.set(client.sessionId, p);
    }
    this.seats.set(client.sessionId, { userId, slot, bucket: MAX_MSG_PER_SEC, lastRefill: Date.now(), drops: 0, dropsSince: Date.now() });
    byUser.set(userId, { room: this, sessionId: client.sessionId });
    client.send("welcome", { slot, mode: this.mode });
    if (this.state.phase === "lobby" && this.state.players.size >= this.capacity) this.start();
    log.info("paint.join", { roomId: this.roomId, people: this.seats.size, slot, back: !!back });
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const mine = byUser.get(s.userId);
    if (mine && mine.room === this && mine.sessionId === client.sessionId) byUser.delete(s.userId);
    if (this.match && this.state.phase !== "lobby") {
      // Na partida: o jogador fica (parado, fora dos alvos); pode voltar pela reserva.
      p.online = false;
      this.match.setOnline(s.slot, false);
      if (!this.clients.length) this.disconnect();
      return;
    }
    this.seats.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    // Na espera os times se rearrumam (quem saiu deixou um buraco).
    this.rebalance();
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

  seatOf(userId) {
    for (const [sid, s] of this.seats) if (s.userId === userId) return { sid, s };
    return null;
  }

  freeSlot() {
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    for (let i = 0; i < this.capacity; i++) if (!used.has(i)) return i;
    return 0;
  }

  pickTeam() {
    if (modeTeams(this.mode) === 1) return 0;
    const n = [0, 0];
    for (const p of this.state.players.values()) n[p.team]++;
    return n[1] < n[0] ? 1 : 0;
  }

  rebalance() {
    const per = [[], []];
    for (const p of this.state.players.values()) per[p.team].push(p);
    for (const list of per) list.sort((a, b) => a.sit - b.sit).forEach((p, i) => (p.sit = i));
  }

  async reserveBack(options) {
    await this.lock();
    this.maxClients = this.capacity + 1;
    try {
      return await matchMaker.reserveSeatFor(this._listing, options).catch(() => null);
    } finally {
      this.maxClients = this.capacity;
    }
  }

  replace(sessionId, sameRoom) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!sameRoom) {
      const p = this.state.players.get(sessionId);
      const s = this.seats.get(sessionId);
      if (p && s && this.match && this.state.phase !== "lobby") {
        p.online = false;
        this.match.setOnline(s.slot, false);
      } else {
        this.seats.delete(sessionId);
        this.state.players.delete(sessionId);
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

  playing(client) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.match || this.match.phase === "end" || !this.takeToken(client, s)) return null;
    return s;
  }

  onPose(client, msg) {
    const s = this.playing(client);
    if (!s || !msg) return;
    this.match.pose(s.slot, { x: num(msg.x), y: num(msg.y), z: num(msg.z), facing: num(msg.f), ground: !!msg.g, gy: num(msg.gy), e: Math.floor(num(msg.e)) });
  }

  onFire(client, msg) {
    const s = this.playing(client);
    if (!s || !msg) return;
    const o = vec(msg.o);
    const d = vec(msg.d);
    const q = Math.max(0, Math.min(4294967295, Math.floor(num(msg.q)) || 0));
    if (!o || !d) return;
    this.match.fire(s.slot, Math.floor(num(msg.c)), o, d, q);
  }

  onPunch(client) {
    const s = this.playing(client);
    if (s) this.match.punch(s.slot);
  }

  onPing(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || !this.takeToken(client, s)) return;
    client.send("pong", { c: Number(msg && msg.c) || 0, t: this.match ? this.match.time : 0 });
  }

  // ── partida ────────────────────────────────────────────────────────────────

  start() {
    const seats = [];
    for (const [sid, p] of this.state.players) {
      const s = this.seats.get(sid);
      if (s) seats.push({ slot: s.slot, team: p.team, sit: p.sit });
    }
    this.match = new PaintMatch(this.mode, seats);
    this.state.phase = "countdown";
    this.state.bossHp = this.match.bossHp;
    void this.lock();
    this.mirror();
    log.info("paint.start", { roomId: this.roomId, mode: this.mode, players: seats.length });
  }

  loop(dtMs) {
    const m = this.match;
    if (!m) return;
    if (m.phase !== "end") m.tick(Math.min(dtMs, 250) / 1000);
    const events = m.drain();
    if (events.length) this.dispatch(events);
    if (this.state.phase === "countdown" && m.phase === "play") this.state.phase = "play";
    this.mirror();
    if (m.phase === "end" && this.state.phase !== "end") this.finish();
  }

  /** Acontecimentos → estado (o que fica) e pacote `ev` (o que é instantâneo). */
  dispatch(events) {
    const pub = [];
    const priv = new Map();
    const to = (slot, e) => {
      if (!priv.has(slot)) priv.set(slot, []);
      priv.get(slot).push(e);
    };
    for (const e of events) {
      switch (e.type) {
        case "blob": {
          const b = e.blob;
          this.state.blobs.set(String(e.id), new PtBlob({ c: b.c, x: b.x, z: b.z, y0: b.y0, y1: b.y1, r: b.r, team: e.team, owner: e.owner, q: e.q || 0 }));
          break;
        }
        case "unblob":
          this.state.blobs.delete(String(e.id));
          break;
        case "cat":
          this.state.cats.set(String(e.id), e.team);
          pub.push(e);
          break;
        case "capsule": {
          const back = this.match.capsuleBack.get(e.id);
          this.state.caps.set(String(e.id), back || 0);
          pub.push(e);
          break;
        }
        case "capsuleBack":
          this.state.caps.delete(String(e.id));
          pub.push(e);
          break;
        case "fix":
        case "deny":
          to(e.slot, e);
          break;
        case "shot":
          pub.push({ ...e, o: { x: r3(e.o.x), y: r3(e.o.y), z: r3(e.o.z) }, to: { x: r3(e.to.x), y: r3(e.to.y), z: r3(e.to.z) } });
          break;
        default:
          pub.push(e);
      }
    }
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (!s) continue;
      const mine = pub.filter((e) => !(e.type === "shot" && e.slot === s.slot));
      const own = priv.get(s.slot);
      if (own) mine.push(...own);
      if (mine.length) client.send("ev", mine);
    }
  }

  mirror() {
    const m = this.match;
    if (!m) return;
    this.state.time = m.time;
    this.state.tc0 = m.teamCats[0];
    this.state.tc1 = m.teamCats[1];
    this.state.p0 = m.portalOpen[0];
    this.state.p1 = m.portalOpen[1];
    this.state.bossHp = Math.max(0, Math.round(m.bossHp));
    for (const [sid, p] of this.state.players) {
      const s = this.seats.get(sid);
      const mp = s && m.players.get(s.slot);
      if (!mp) continue;
      const q = mp.pose;
      p.x = q.x;
      p.y = q.y;
      p.z = q.z;
      p.f = q.facing;
      p.g = q.ground;
      p.e = mp.epoch;
      p.hp = mp.hp;
      p.a0 = mp.ammo[0];
      p.a1 = mp.ammo[1];
      p.a2 = mp.ammo[2];
      p.cats = mp.cats;
      p.dmg = Math.round(mp.dmg);
      p.ko = mp.ko;
      p.boss = mp.inBoss;
    }
  }

  finish() {
    this.state.phase = "end";
    this.state.result = JSON.stringify(this.match.result);
    this.state.until = Date.now() + timing.closeMs;
    log.info("paint.end", { roomId: this.roomId, mode: this.mode, winnerTeam: this.match.result.winnerTeam });
    this.closeTimer = this.clock.setTimeout(() => this.disconnect(), timing.closeMs);
  }
}

// ── API para o serviço ───────────────────────────────────────────────────────

let ready = false;
function define(gameServer) {
  gameServer.define(PAINT_ROOM, PaintRoom).filterBy(["centerRoomId", "mode"]).sortBy({ clients: -1 });
  ready = true;
}

/**
 * Reserva o lugar numa sala do Paint do centro em que a pessoa está, no modo
 * pedido. Quem chama já conferiu papel, centro e porta. `roomId` = estava
 * numa sala há pouco (reconexão): volta para o MESMO jogador, se existir.
 */
async function reservePaintSeat({ userId, name, body, centerRoomId, mode, roomId = null }) {
  if (!ready) throw Object.assign(new Error("multiplayer indisponível"), { statusCode: 503 });
  const options = { centerRoomId, mode, userId, name, body };
  if (roomId) {
    const room = rooms.get(roomId);
    if (room && room.seatOf(userId)) {
      const seat = await room.reserveBack(options);
      if (seat) return seat;
    }
  }
  // Treino: sala só sua, sempre nova.
  if (mode === "solo") return matchMaker.create(PAINT_ROOM, options);
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await matchMaker.joinOrCreate(PAINT_ROOM, options);
    } catch (err) {
      last = err;
      if (!/full|SeatReservation|locked/i.test(String(err && err.name + err.message))) throw err;
    }
  }
  throw last;
}

/** A pessoa saiu do centro (voltou para casa): sai do Paint também. */
function leavePaint(userId) {
  const mine = byUser.get(userId);
  if (!mine) return;
  byUser.delete(userId);
  mine.room.replace(mine.sessionId, false);
}

async function paintStatus() {
  const list = await matchMaker.query({ name: PAINT_ROOM });
  return { paintRooms: list.length, paintClients: list.reduce((n, r) => n + (r.clients || 0), 0) };
}

module.exports = {
  define,
  reservePaintSeat,
  leavePaint,
  paintStatus,
  PAINT_ROOM,
  // só para a suíte e2e
  _paintRooms: () => [...rooms.values()],
  _paintTiming: timing,
};
