// src/realtime/meuMundoDuel.js — o COLISEU: luta direta entre duas pessoas na porta (2026-11-24).
//
// Pedido do Alex: o prédio do Boxe vira o Coliseu. Quem chega perto e vê outra pessoa
// também perto ganha o botão "Lutar" em cima dela; o toque leva OS DOIS para a mesma luta
// no palco da Arena das Lâminas, sem aceite (como o monstro da rua que te alcança).
//
// Quem manda em quê (REDE.md):
//  - a SALA confere a entrada: os dois na frente do Coliseu (DUEL.near da porta), perto um
//    do outro (DUEL.pair), a pé, livres (sem menu/minijogo/luta — `mobBusy`), gente de
//    verdade (robô `bot-*` não tem aparelho);
//  - cada aparelho roda o SEU lutador na regra das Lâminas e manda o próprio estado
//    (`dst`, repassado ao outro, que desenha um boneco) e as pancadas que deu (`dhit`);
//  - a VIDA dos dois mora aqui: a pancada é limitada (DUEL.hitCap da vida de quem leva,
//    no máximo uma a cada DUEL.hitGapMs) e só vale com os dois prontos (`dready`);
//  - a sala decide o fim: vida zero, desistência, queda da conexão, tempo.
// Sem prêmio por enquanto (economia do PvP é decisão do Alex): o duelo não grava nada no
// banco e o laço da sala nunca espera.

const DUEL = Object.freeze({
  /** Distância máxima da porta do Coliseu (m) para lutar — o botão aparece nisto. */
  near: 14,
  /** Distância máxima entre os dois (m). */
  pair: 10,
  /** Sem os dois prontos (tela de versus) neste prazo, a luta é desfeita sem vencedor. */
  readyMs: 60_000,
  /** Luta mais longa que isto acaba pelo tempo (quem tem mais vida em % vence). */
  maxMs: 6 * 60_000,
  /** Uma pancada no máximo a cada isto (ms) de cada lado. */
  hitGapMs: 90,
  /** A maior pancada: esta fração da vida máxima de quem leva. */
  hitCap: 0.35,
  /** Vida máxima aceita do aparelho (a regra das Lâminas dá 100+ por nível). */
  hpMin: 50,
  hpMax: 1_000_000,
  /** Vida antes do `dready` (a tela de versus ainda aberta). */
  hpDefault: 100,
  /** Estado repassado no máximo a cada isto (ms). */
  stateGapMs: 33,
  /** Raio do palco (a ARENA_R da regra + folga): posição fora disto é cortada. */
  arena: 12,
});

/** Estados do lutador que o outro aparelho desenha (PlayerState da regra das Lâminas). */
const STATES = Object.freeze(["idle", "attack", "dodge", "hurt", "down", "win", "power", "skill"]);

const num = (v, lo, hi, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

class DuelHub {
  constructor() {
    /** id → duelo */
    this.duels = new Map();
    /** sessionId → id do duelo */
    this.bySid = new Map();
    this.seq = 0;
  }

  /** Duelo em que esta sessão está (ou null). */
  of(sid) {
    const id = this.bySid.get(sid);
    return id ? this.duels.get(id) || null : null;
  }

  busy(sid) {
    return this.bySid.has(sid);
  }

  /**
   * `a` quer lutar com `b`. `who(sid)` devolve { x, z, car, busy, bot } ou null; `door` = a porta
   * do Coliseu. Devolve { duel } ou { error } (far | pair | busy | self | bot | gone | driving).
   */
  challenge(a, b, who, door, now = Date.now()) {
    if (!a || !b || a === b) return { error: "self" };
    if (String(b).startsWith("bot-")) return { error: "bot" };
    const pa = who(a);
    const pb = who(b);
    if (!pa || !pb) return { error: "gone" };
    if (pb.bot) return { error: "bot" };
    if (pa.car || pb.car) return { error: "driving" };
    if (this.busy(a) || this.busy(b) || pa.busy || pb.busy) return { error: "busy" };
    const da = Math.hypot(pa.x - door.x, pa.z - door.z);
    const db = Math.hypot(pb.x - door.x, pb.z - door.z);
    if (da > DUEL.near || db > DUEL.near) return { error: "far" };
    if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > DUEL.pair) return { error: "pair" };
    const id = ++this.seq;
    const duel = {
      id,
      sids: [a, b],
      hp: [DUEL.hpDefault, DUEL.hpDefault],
      max: [DUEL.hpDefault, DUEL.hpDefault],
      ready: [false, false],
      lastHit: [0, 0],
      lastState: [0, 0],
      at: now,
      live: false,
      liveAt: 0,
      over: null,
    };
    this.duels.set(id, duel);
    this.bySid.set(a, id);
    this.bySid.set(b, id);
    return { duel };
  }

  /** Lado (0/1) desta sessão no duelo. */
  side(duel, sid) {
    return duel.sids[0] === sid ? 0 : duel.sids[1] === sid ? 1 : -1;
  }

  /** O aparelho apertou "Lutar" na tela de versus e diz a vida máxima do lutador. Devolve true quando os dois ficaram prontos agora. */
  ready(sid, hpMax, now = Date.now()) {
    const d = this.of(sid);
    if (!d || d.over) return false;
    const k = this.side(d, sid);
    if (d.ready[k]) return false;
    const m = Math.round(num(hpMax, DUEL.hpMin, DUEL.hpMax, DUEL.hpDefault));
    d.ready[k] = true;
    d.max[k] = m;
    d.hp[k] = m;
    if (d.ready[0] && d.ready[1]) {
      d.live = true;
      d.liveAt = now;
      return true;
    }
    return false;
  }

  /** Estado do lutador para o outro desenhar: { to, msg } ou null (fora de hora, rápido demais, lixo). */
  state(sid, msg, now = Date.now()) {
    const d = this.of(sid);
    if (!d || d.over || !msg || typeof msg !== "object") return null;
    const k = this.side(d, sid);
    if (now - d.lastState[k] < DUEL.stateGapMs) return null;
    d.lastState[k] = now;
    const s = STATES.includes(msg.s) ? msg.s : "idle";
    const out = {
      x: Math.round(num(msg.x, -DUEL.arena, DUEL.arena) * 100) / 100,
      z: Math.round(num(msg.z, -DUEL.arena, DUEL.arena) * 100) / 100,
      f: Math.round(num(msg.f, -10, 10) * 1000) / 1000,
      s,
      t: Math.round(num(msg.t, 0, 30) * 100) / 100,
      c: Math.round(num(msg.c, 0, 9)),
      v: Math.round(num(msg.v, 0, 20) * 100) / 100,
    };
    // a habilidade em curso (Corte Mágico, Investida, Escudo) para o desenho
    if (s === "skill" && ["slash", "dash", "shield"].includes(msg.k)) out.k = msg.k;
    return { to: d.sids[1 - k], msg: out };
  }

  /**
   * Pancada que `sid` deu no outro. Devolve { victim, dmg, heavy, hp, end } ou null (fora de hora,
   * rápido demais, lixo). `end` = { winner, loser, reason } quando a vida acabou.
   */
  hit(sid, msg, now = Date.now()) {
    const d = this.of(sid);
    if (!d || d.over || !d.live || !msg || typeof msg !== "object") return null;
    const k = this.side(d, sid);
    const v = 1 - k;
    if (now - d.lastHit[k] < DUEL.hitGapMs) return null;
    const raw = Number(msg.d);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    d.lastHit[k] = now;
    const dmg = Math.max(1, Math.min(Math.round(raw), Math.round(d.max[v] * DUEL.hitCap)));
    d.hp[v] = Math.max(0, d.hp[v] - dmg);
    const out = { victim: d.sids[v], dmg, heavy: msg.h === 1 || msg.h === true, hp: d.hp.slice(), end: null };
    if (d.hp[v] <= 0) out.end = this.finish(d, k, "ko");
    return out;
  }

  /** Desistiu (ou saiu da tela): o outro vence. */
  quit(sid) {
    const d = this.of(sid);
    if (!d || d.over) return null;
    return this.finish(d, 1 - this.side(d, sid), "quit");
  }

  /** A conexão caiu / saiu da sala: o outro vence (antes de começar = desfeita). */
  drop(sid) {
    const d = this.of(sid);
    if (!d) return null;
    if (d.over) {
      this.forget(d);
      return null;
    }
    return d.live ? this.finish(d, 1 - this.side(d, sid), "drop") : this.finish(d, -1, "void");
  }

  /** Prazos: versus esquecido (desfeita) e luta longa demais (vence quem tem mais vida em %). */
  expire(now = Date.now()) {
    const ends = [];
    for (const d of this.duels.values()) {
      if (d.over) continue;
      if (!d.live && now - d.at > DUEL.readyMs) ends.push(this.finish(d, -1, "void"));
      else if (d.live && now - d.liveAt > DUEL.maxMs) {
        const a = d.hp[0] / d.max[0];
        const b = d.hp[1] / d.max[1];
        ends.push(this.finish(d, a === b ? -1 : a > b ? 0 : 1, "time"));
      }
    }
    return ends;
  }

  /** Fecha o duelo: `w` = lado que venceu (−1 = ninguém). */
  finish(d, w, reason) {
    d.over = { w, reason };
    const end = { id: d.id, sids: d.sids.slice(), winner: w >= 0 ? d.sids[w] : null, loser: w >= 0 ? d.sids[1 - w] : null, reason };
    this.forget(d);
    return end;
  }

  forget(d) {
    this.duels.delete(d.id);
    for (const s of d.sids) if (this.bySid.get(s) === d.id) this.bySid.delete(s);
  }
}

module.exports = { DUEL, STATES, DuelHub };
