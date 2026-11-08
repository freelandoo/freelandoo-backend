// src/utils/meuMundoPaintBot.js — o COMPUTADOR do Paint (regra do Alex, 2026-11-08: 1×1, 2×2
// e 3×3 esperam até 1 minuto e as vagas vazias viram computadores, como a Gincana).
//
// Roda na sala (src/realtime/meuMundoPaint.js) com a regra GERADA (meuMundoPaint.js ← paint/sim).
// No Paint o movimento é do aparelho; o computador não tem aparelho, então ele tem um CORPO
// próprio (newBody/stepBody, a mesma física do aparelho) e conversa com a partida como um
// aparelho conversaria: pose a cada passo (`match.pose`), tiro (`match.fire`) e soco
// (`match.punch`). Nada de regra nova: munição, tinta, dano e gatinhos são da partida.
//
// O "cérebro" é o robô dos testes (test/unit/meuMundoPaintMaps.test.js: sobe a rota de cada
// time em todos os mapas — ponte turquesa no vão, cama elástica para subir, gatinhos e
// cápsulas no caminho), virado PROGRAMA PASSO A PASSO: um gerador que devolve a entrada de
// cada passo da física, para a sala avançar sem travar. Por cima, o combate: de tempos em
// tempos olha o adversário mais perto; perto e na mesma altura, atira tinta de dano (com erro
// de mira pela habilidade) ou soca. Caiu/derrubado: a partida renasce o corpo e ele recomeça
// a rota da base. Travou no caminho (sem munição, ponte que não chega): fica rondando a ilha.

const P = require("./meuMundoPaint");

const { TUNING: T, PAINT } = P;
const IDLE = Object.freeze({ mx: 0, mz: 0, run: false, jump: false });

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ptsOf = (isl) => {
  if (isl.poly) {
    const out = [];
    for (let i = 0; i < isl.poly.length; i += 2) out.push([isl.poly[i], isl.poly[i + 1]]);
    return out;
  }
  return Array.from({ length: 24 }, (_, i) => [isl.x + Math.sin((i / 24) * Math.PI * 2) * isl.r, isl.z + Math.cos((i / 24) * Math.PI * 2) * isl.r]);
};
const solidCache = new WeakMap();
function contains(isl, x, z, pad = 0) {
  let s = solidCache.get(isl);
  if (!s) solidCache.set(isl, (s = P.polySolid(ptsOf(isl).flat(), 0, 1)));
  for (let i = 0; i < s.d.length; i++) if (s.n[i * 2] * x + s.n[i * 2 + 1] * z - s.d[i] > pad) return false;
  return true;
}

class PaintBot {
  /**
   * @param match a partida (PaintMatch) da sala
   * @param slot  a vaga do computador
   * @param skill 0–1 (mira e reação)
   * @param luck  semente dos sorteios
   */
  constructor(match, slot, skill, luck) {
    this.m = match;
    this.slot = slot;
    this.p = match.players.get(slot);
    this.skill = Math.max(0, Math.min(1, skill));
    this.rnd = rng(luck);
    this.q = 0;
    this.lookIn = 0;
    this.reset();
  }

  reset() {
    const pose = this.p.pose;
    this.b = P.newBody(pose.x, pose.y, pose.z, pose.facing);
    this.prog = this.route();
  }

  /** A partida renasceu o computador (evento `respawn`): corpo novo e a rota de novo. */
  respawn(e) {
    this.b = P.newBody(e.x, e.y, e.z, e.facing);
    this.prog = this.route();
  }

  sync() {
    const b = this.b;
    this.m.pose(this.slot, { x: b.x, y: b.y, z: b.z, facing: b.facing, ground: b.ground, gy: b.gy, e: this.p.epoch });
  }

  /** Um passo da física (a sala chama 1/T.step vezes por segundo). */
  step() {
    const p = this.p;
    if (!p || p.out || this.m.phase !== "play") return;
    if (p.ko) {
      this.sync();
      return;
    }
    this.combat();
    const n = this.prog.next();
    const it = n.done ? IDLE : n.value || IDLE;
    if (n.done) this.prog = this.wander();
    P.stepBody(this.b, it, this.m.solids());
    this.sync();
  }

  // ── combate ────────────────────────────────────────────────────────────────

  combat() {
    this.lookIn -= T.step;
    if (this.lookIn > 0) return;
    // reação: forte olha a cada ~0,25 s, fraco a cada ~0,6 s
    this.lookIn = 0.25 + 0.35 * (1 - this.skill) + this.rnd() * 0.15;
    const me = this.b;
    let best = null;
    let bd = Infinity;
    for (const [slot, o] of this.m.players) {
      if (slot === this.slot || o.team === this.p.team || o.ko || o.out || !o.pose) continue;
      if (Math.abs(o.pose.y - me.y) > 5) continue;
      const d = Math.hypot(o.pose.x - me.x, o.pose.z - me.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return;
    if (bd < 1.8 && this.m.time >= this.p.nextPunch) {
      me.facing = Math.atan2(best.pose.x - me.x, best.pose.z - me.z);
      this.m.punch(this.slot);
      return;
    }
    if (bd > T.range[PAINT.HARM] * 0.9 || this.p.ammo[PAINT.HARM] < T.cost[PAINT.HARM] || this.m.time < this.p.nextFire[PAINT.HARM]) return;
    // nem sempre atira (os fracos hesitam mais)
    if (this.rnd() > 0.45 + 0.5 * this.skill) return;
    me.facing = Math.atan2(best.pose.x - me.x, best.pose.z - me.z);
    const o = P.muzzleOf(me, me.facing);
    let dx = best.pose.x - o.x;
    let dy = best.pose.y + 1.1 - o.y;
    let dz = best.pose.z - o.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // erro de mira: forte ~2°, fraco ~9°
    const err = (0.035 + 0.12 * (1 - this.skill)) * (this.rnd() * 2 - 1);
    const errY = (0.02 + 0.06 * (1 - this.skill)) * (this.rnd() * 2 - 1);
    const ca = Math.cos(err);
    const sa = Math.sin(err);
    const rx = (dx * ca - dz * sa) / len;
    const rz = (dx * sa + dz * ca) / len;
    this.m.fire(this.slot, PAINT.HARM, o, { x: rx, y: dy / len + errY, z: rz }, ++this.q);
  }

  // ── a rota (o robô dos testes, passo a passo) ─────────────────────────────

  *wait(n) {
    for (let i = 0; i < n; i++) yield IDLE;
  }

  /** Anda até (x, z); `safe` = para na beirada em vez de cair. */
  *walkTo(x, z, safe, maxN = 600) {
    const b = this.b;
    for (let i = 0; i < maxN; i++) {
      const dx = x - b.x;
      const dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) break;
      if (safe) {
        const nx = b.x + (dx / d) * 0.5;
        const nz = b.z + (dz / d) * 0.5;
        if (P.supportAt(this.m.solids(), nx, nz, b.y + 0.3) < b.y - 0.5) break;
      }
      const s = Math.min(1, d / 1.2);
      yield { mx: (dx / d) * s, mz: (dz / d) * s, run: d > 6, jump: false };
    }
    yield* this.wait(10);
  }

  /** Atira a cor `c` na direção `dir` quando a arma deixa; devolve a tinta criada (ou null). */
  *fire(c, dir) {
    let guard = 0;
    while (this.m.time + 0.03 < this.p.nextFire[c] && guard++ < 400) yield IDLE;
    if (this.p.ammo[c] < T.cost[c]) return null;
    const b = this.b;
    const o = P.muzzleOf(b, b.facing);
    const before = this.m.blobs.size;
    this.m.fire(this.slot, c, o, dir, ++this.q);
    const made = this.m.blobs.size > before ? [...this.m.blobs.values()].pop() : null;
    if (made && made.owner === this.slot) P.liftOnto(b, made.blob.x, made.blob.z, made.blob.r, made.blob.y1);
    return made;
  }

  edgeToward(isl, ux, uz) {
    let lo = 0;
    let hi = 60;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (contains(isl, isl.x + ux * m, isl.z + uz * m)) lo = m;
      else hi = m;
    }
    return lo;
  }

  /** Vai para a ilha `to` (ponte no vão; cama elástica se ela for mais alta). Devolve false se travou. */
  *hop(to) {
    const b = this.b;
    const dx = to.x - b.x;
    const dz = to.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const edge = this.edgeToward(to, -ux, -uz);
    yield* this.walkTo(b.x + ux * 30, b.z + uz * 30, true);
    b.facing = Math.atan2(to.x - b.x, to.z - b.z);
    let guard = 0;
    for (;;) {
      const reachTo = Math.hypot(to.x - b.x, to.z - b.z) - edge;
      const made = [...this.m.blobs.values()].filter((x) => x.owner === this.slot && x.blob.c === PAINT.BRIDGE && Math.abs(x.blob.y1 - b.y) < 0.25);
      const far = made.length ? Math.min(...made.map((x) => Math.hypot(to.x - x.blob.x, to.z - x.blob.z))) : Infinity;
      if (reachTo < 0.5 || far < edge + 0.4) break;
      if (guard++ > 40 || this.p.ammo[PAINT.BRIDGE] < 1) return false;
      b.facing = Math.atan2(to.x - b.x, to.z - b.z);
      yield* this.fire(PAINT.BRIDGE, { x: ux, y: 0, z: uz });
      yield* this.walkTo(b.x + ux * 30, b.z + uz * 30, true, 40);
    }
    if (to.y > b.y + 0.3) {
      for (let i = 0; i < 400; i++) {
        const g = Math.hypot(to.x - b.x, to.z - b.z) - (edge + 1.4);
        if (Math.abs(g) < 0.12) break;
        const bx = b.x;
        const bz = b.z;
        const sgn = g > 0 ? 1 : -1;
        yield { mx: ux * sgn * 0.5, mz: uz * sgn * 0.5, run: false, jump: false };
        if (Math.hypot(b.x - bx, b.z - bz) < 1e-4) break;
      }
      yield* this.wait(20);
      if (this.p.ammo[PAINT.STEP] < T.cost[PAINT.STEP]) return false;
      b.facing = Math.atan2(-ux, -uz);
      yield IDLE;
      const pad = yield* this.fire(PAINT.STEP, { x: 0, y: -1, z: 0 });
      if (!pad || pad.blob.c !== PAINT.STEP) return false;
      let bounced = false;
      for (let i = 0; i < 300; i++) {
        const toward = bounced ? (b.y > to.y + 0.1 ? 1 : 0) : -1;
        const jump = bounced && !b.ground && b.vy < 1 && b.y < to.y + 0.4 && b.jumps < T.maxJumps;
        yield { mx: ux * toward, mz: uz * toward, run: false, jump };
        if (b.bounce !== null) bounced = true;
        if (bounced && b.ground) break;
      }
      if (!bounced) return false;
    }
    yield* this.walkTo(to.x, to.z, false);
    return Math.abs(b.y - to.y) < 0.3 && contains(to, b.x, b.z, 0.5);
  }

  /** Pega cápsulas e gatinhos da ilha e volta para o meio dela. */
  *sweep(isl) {
    const m = this.m.map;
    for (const c of m.capsules) if (Math.abs(c.y - isl.y) < 0.01 && contains(isl, c.x, c.z)) yield* this.walkTo(c.x, c.z, true);
    for (const c of m.cats) if (Math.abs(c.y - isl.y) < 0.01 && contains(isl, c.x, c.z)) yield* this.walkTo(c.x, c.z, true);
    yield* this.walkTo(isl.x, isl.z, false);
  }

  /** Da base ao alto pela rota do time; travou = ronda onde está. */
  *route() {
    const m = this.m.map;
    const ids = m.routes && m.routes[this.p.team];
    if (!ids || !ids.length) return yield* this.wander();
    const route = ids.map((i) => m.islands[i]);
    // começa pela ilha onde ele está (renasceu na base ou já subiu um pedaço)
    let at = 0;
    for (let i = route.length - 1; i >= 0; i--) {
      if (Math.abs(route[i].y - this.b.y) < 0.5 && contains(route[i], this.b.x, this.b.z, 1)) {
        at = i;
        break;
      }
    }
    // um respiro antes de sair (fraco sai mais devagar)
    yield* this.wait(Math.round((0.3 + 1.2 * (1 - this.skill)) / T.step));
    yield* this.sweep(route[at]);
    for (let i = at + 1; i < route.length; i++) {
      const ok = yield* this.hop(route[i]);
      if (!ok) return yield* this.wander();
      yield* this.sweep(route[i]);
    }
    return yield* this.wander();
  }

  /** Ronda a ilha onde está (o combate segue valendo). */
  *wander() {
    const b = this.b;
    for (;;) {
      const a = this.rnd() * Math.PI * 2;
      const r = 1.5 + this.rnd() * 3;
      yield* this.walkTo(b.x + Math.sin(a) * r, b.z + Math.cos(a) * r, true, 120);
      yield* this.wait(Math.round((0.4 + this.rnd()) / T.step));
    }
  }
}

module.exports = { PaintBot };
