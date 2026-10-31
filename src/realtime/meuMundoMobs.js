// src/realtime/meuMundoMobs.js — MEU MUNDO 3D mm3d-48b/57b: invasões de monstros.
//
// Pedido do Alex (29/10): monstros aparecem na cidade de vez em quando e quem
// encontra luta com eles na Arena das Lâminas. A sala (CentroRoom e, desde a
// mm3d-57b, BairroRoom) é dona disto: sorteia quando e onde nasce cada um, faz
// o monstro andar devagar em volta do ponto e o tira quando alguém vence.
//
// Regras (mm3d-57b, pedido do Alex em 30/10):
//  - SÓ DE NOITE (relógio de Brasília, 18h–6h — o mesmo do céu); ao amanhecer
//    quem não está lutando vai embora;
//  - a primeira invasão sai 1–2 min depois de escurecer (ou de a sala abrir de
//    noite); as seguintes a cada 4–10 min; no máximo 2 ao mesmo tempo;
//  - nasce em lugar livre (fora de prédios, árvores e postes), longe de quem
//    está perto (≥ 8 m) e de outro monstro (≥ 20 m);
//  - anda numa volta de ~3,5 m em volta do ponto, a 0,7 m/s;
//  - quem fica DE FRENTE para ele (até 12 m, ±50° do focinho) é perseguido a
//    3,2 m/s (correndo dá para escapar; andando, não); desiste a 22 m;
//  - alcançou (≤ 1,8 m) = a LUTA abre sozinha para essa pessoa (evento
//    `caught`); o monstro fica parado até a luta acabar (vitória = sai da
//    cidade; derrota = volta a andar, e quem perdeu fica 30 s em paz);
//  - some em 10 min sem ninguém vencer (menos durante uma luta);
//  - vitória vale para quem está lutando com ele ou perto (≤ 25 m) — a luta
//    roda no aparelho por enquanto (sem prêmio em moedas).
//
// Nada aqui sabe de Colyseus: a sala chama `tick`, `list`, `engage`, `claim`,
// `release` e `drop`.

const KINDS = Object.freeze([
  ["wolf", 35],
  ["golem", 25],
  ["harpy", 20],
  ["brute", 20],
]);

const MOBS = Object.freeze({
  FIRST_MS: [60_000, 120_000],
  EVERY_MS: [240_000, 600_000],
  MAX_ALIVE: 2,
  LIFE_MS: 600_000,
  WANDER_R: 3.5,
  WANDER_V: 0.7,
  RADIUS: 1.4,
  FAR_FROM_PLAYER: 8,
  FAR_FROM_MOB: 20,
  CLAIM_REACH: 25,
  SIGHT: 12,
  /** Metade do cone de visão (rad): ±50°. */
  SIGHT_HALF: (50 * Math.PI) / 180,
  CHASE_V: 3.2,
  LOSE: 22,
  CATCH: 1.8,
  /** Luta sem resposta do aparelho: o monstro volta a andar. */
  FIGHT_MS: 300_000,
  /** Quem perdeu (ou estava ocupado) fica em paz por este tempo. */
  CALM_MS: 30_000,
  BUSY_MS: 120_000,
  /** Pontos candidatos: grade de 4 m dentro de ±SPAN (cada sala passa o seu). */
  GRID: 4,
  SPAN: 56,
  NIGHT_FROM: 18,
  NIGHT_TO: 6,
});

const r2 = (v) => Math.round(v * 100) / 100;

/** Hora de Brasília (0–24) — UTC−3 fixo: Brasília não tem horário de verão desde 2019. */
function brasiliaHour(now) {
  const d = new Date(now);
  return (((d.getUTCHours() - 3 + 24) % 24) + d.getUTCMinutes() / 60) % 24;
}

function isNight(now) {
  const h = brasiliaHour(now);
  return h >= MOBS.NIGHT_FROM || h < MOBS.NIGHT_TO;
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

class MobDirector {
  /**
   * @param {object} o
   * @param {(x:number, z:number, radius:number) => boolean} o.isFree lugar livre para nascer
   * @param {(x:number, z:number, radius:number) => {x:number, z:number}} [o.collide] tira de dentro de parede/prédio
   * @param {number} [o.span] metade do lado da área de nascer (m)
   * @param {(now:number) => boolean} [o.night] é noite? (padrão: relógio de Brasília)
   * @param {() => number} [o.rng]
   * @param {number} [o.now] ms
   */
  constructor({ isFree, collide = (x, z) => ({ x, z }), span = MOBS.SPAN, night = isNight, rng = Math.random, now = Date.now() }) {
    this.isFree = isFree;
    this.collide = collide;
    this.span = span;
    this.night = night;
    this.rng = rng;
    this.mobs = new Map();
    /** sessionId → até quando o monstro não persegue essa pessoa. */
    this.calm = new Map();
    this.seq = 0;
    this.wasNight = night(now);
    this.nextAt = now + this.between(MOBS.FIRST_MS);
  }

  /** Lugares possíveis AGORA (a colisão do bairro muda quando uma casa sobe de nível). */
  spots() {
    const out = [];
    const span = Math.floor(this.span / MOBS.GRID) * MOBS.GRID;
    for (let x = -span; x <= span; x += MOBS.GRID) {
      for (let z = -span; z <= span; z += MOBS.GRID) {
        // Precisa caber a volta inteira em volta do ponto.
        if (this.isFree(x, z, MOBS.RADIUS + MOBS.WANDER_R)) out.push({ x, z });
      }
    }
    return out;
  }

  between([a, b]) {
    return a + (b - a) * this.rng();
  }

  pickKind() {
    const total = KINDS.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng() * total;
    for (const [k, w] of KINDS) {
      roll -= w;
      if (roll <= 0) return k;
    }
    return KINDS[0][0];
  }

  /** Volta a andar em círculo a partir de onde está (depois de perseguir ou lutar). */
  wanderFromHere(m) {
    m.mode = "wander";
    m.target = null;
    // O centro novo fica a WANDER_R de onde ele está, atrás dele.
    m.a = m.facing + Math.PI;
    m.cx = m.x - Math.sin(m.a) * MOBS.WANDER_R;
    m.cz = m.z - Math.cos(m.a) * MOBS.WANDER_R;
  }

  /**
   * Avança o relógio. `players` = quem está a pé na sala: [{ sid, x, z }].
   * Devolve { changed, caught: [{ sid, id, kind }] }.
   */
  tick(now, players, dt) {
    let changed = false;
    const caught = [];
    const night = this.night(now);
    if (night && !this.wasNight) this.nextAt = now + this.between(MOBS.FIRST_MS);
    this.wasNight = night;
    for (const [sid, until] of this.calm) if (until <= now) this.calm.delete(sid);
    const bySid = new Map(players.map((p) => [p.sid, p]));

    for (const m of this.mobs.values()) {
      if (m.mode === "fight") {
        if (now - m.fightAt < MOBS.FIGHT_MS && bySid.has(m.target)) continue;
        this.wanderFromHere(m);
        changed = true;
      }
      if (!night || now - m.born >= MOBS.LIFE_MS) {
        this.mobs.delete(m.id);
        changed = true;
        continue;
      }
      if (m.mode === "chase") {
        const p = bySid.get(m.target);
        const d = p ? Math.hypot(p.x - m.x, p.z - m.z) : Infinity;
        if (!p || d > MOBS.LOSE || this.calm.has(m.target)) {
          this.wanderFromHere(m);
        } else if (d <= MOBS.CATCH) {
          m.mode = "fight";
          m.fightAt = now;
          m.facing = Math.atan2(p.x - m.x, p.z - m.z);
          caught.push({ sid: m.target, id: m.id, kind: m.kind });
          changed = true;
          continue;
        } else {
          const step = Math.min(MOBS.CHASE_V * dt, d - MOBS.CATCH * 0.5);
          m.facing = Math.atan2(p.x - m.x, p.z - m.z);
          const c = this.collide(m.x + Math.sin(m.facing) * step, m.z + Math.cos(m.facing) * step, MOBS.RADIUS);
          m.x = c.x;
          m.z = c.z;
          continue;
        }
      }
      // Andando em volta do ponto.
      m.a += (MOBS.WANDER_V / MOBS.WANDER_R) * m.dir * dt;
      const c = this.collide(m.cx + Math.sin(m.a) * MOBS.WANDER_R, m.cz + Math.cos(m.a) * MOBS.WANDER_R, MOBS.RADIUS);
      m.x = c.x;
      m.z = c.z;
      // rumo = a tangente da volta
      m.facing = m.a + (m.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      // Alguém de frente para ele? Persegue o mais perto.
      let best = null;
      let bestD = MOBS.SIGHT;
      for (const p of players) {
        if (this.calm.has(p.sid) || this.isEngaged(p.sid)) continue;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d > bestD) continue;
        if (Math.abs(angleDiff(Math.atan2(p.x - m.x, p.z - m.z), m.facing)) > MOBS.SIGHT_HALF) continue;
        best = p;
        bestD = d;
      }
      if (best) {
        m.mode = "chase";
        m.target = best.sid;
        changed = true;
      }
    }

    if (night && now >= this.nextAt) {
      this.nextAt = now + this.between(MOBS.EVERY_MS);
      if (this.mobs.size < MOBS.MAX_ALIVE && this.spawn(now, players)) changed = true;
    }
    return { changed, caught };
  }

  /** Essa pessoa já está sendo perseguida ou lutando com um monstro? */
  isEngaged(sid) {
    for (const m of this.mobs.values()) if (m.target === sid) return true;
    return false;
  }

  spawn(now, players) {
    const ok = this.spots().filter(
      (p) =>
        players.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= MOBS.FAR_FROM_PLAYER) &&
        [...this.mobs.values()].every((m) => Math.hypot(m.cx - p.x, m.cz - p.z) >= MOBS.FAR_FROM_MOB)
    );
    if (!ok.length) return null;
    const at = ok[Math.floor(this.rng() * ok.length)];
    const a = this.rng() * Math.PI * 2;
    const m = {
      id: ++this.seq,
      kind: this.pickKind(),
      cx: at.x,
      cz: at.z,
      a,
      dir: this.rng() < 0.5 ? -1 : 1,
      x: at.x + Math.sin(a) * MOBS.WANDER_R,
      z: at.z + Math.cos(a) * MOBS.WANDER_R,
      facing: 0,
      born: now,
      mode: "wander",
      target: null,
      fightAt: 0,
    };
    this.mobs.set(m.id, m);
    return m;
  }

  /** Lista que vai para a rede: [id, tipo, x, z, rumo]. */
  list() {
    return [...this.mobs.values()].map((m) => [m.id, m.kind, r2(m.x), r2(m.z), r2(m.facing)]);
  }

  get(id) {
    return this.mobs.get(Number(id)) || null;
  }

  /** "Lutar" apertado perto do monstro: ele para e espera o fim da luta dessa pessoa. */
  engage(id, sid, x, z, now) {
    const m = this.get(id);
    if (!m || m.mode === "fight" || Math.hypot(m.x - x, m.z - z) > MOBS.CLAIM_REACH) return null;
    m.mode = "fight";
    m.target = sid;
    m.fightAt = now;
    return m;
  }

  /** Alguém venceu o monstro `id` estando em (x, z): sai da cidade. Devolve o monstro ou null. */
  claim(id, x, z, sid = null) {
    const m = this.get(id);
    if (!m) return null;
    const mine = m.mode === "fight" && m.target === sid;
    if (!mine && Math.hypot(m.x - x, m.z - z) > MOBS.CLAIM_REACH) return null;
    if (m.mode === "fight" && !mine) return null;
    this.mobs.delete(m.id);
    return m;
  }

  /** Perdeu (ou estava ocupado demais para lutar): o monstro volta a andar e a pessoa fica em paz. */
  release(id, sid, now, busy = false) {
    this.calm.set(sid, now + (busy ? MOBS.BUSY_MS : MOBS.CALM_MS));
    const m = this.get(id);
    if (!m || m.target !== sid) return false;
    this.wanderFromHere(m);
    return true;
  }

  /** A pessoa saiu da sala: quem a perseguia ou lutava com ela volta a andar. */
  drop(sid) {
    this.calm.delete(sid);
    for (const m of this.mobs.values()) if (m.target === sid) this.wanderFromHere(m);
  }

  /** Teste e admin: invasão agora. */
  forceSpawn(now, players) {
    return this.spawn(now, players);
  }
}

module.exports = { MobDirector, MOBS, KINDS, isNight, brasiliaHour };
