// src/realtime/meuMundoMobs.js — MEU MUNDO 3D mm3d-48b: invasões de monstros no centro.
//
// Pedido do Alex (29/10): monstros aparecem na cidade de vez em quando; quem
// encontra entra num PORTAL e luta com eles na Arena das Lâminas. A sala do
// centro (CentroRoom) é dona disto: sorteia quando e onde nasce cada um, faz o
// monstro andar devagar em volta do ponto e o tira quando alguém vence (ou
// quando passa o tempo — depois, o golpe de luz da estátua mais perto).
//
// Regras:
//  - a primeira invasão sai 1–2 min depois de a sala abrir; as seguintes a
//    cada 4–10 min; no máximo 2 monstros ao mesmo tempo;
//  - nasce em lugar livre (fora de prédios, árvores e postes), longe de quem
//    está perto (≥ 8 m) e de outro monstro (≥ 20 m);
//  - anda numa volta de ~3,5 m em volta do ponto, a 0,7 m/s;
//  - some em 10 min sem ninguém vencer;
//  - vitória vale só para quem está perto do monstro (≤ 25 m) — a luta roda no
//    aparelho por enquanto (sem prêmio em moedas até a luta ir para a sala).
//
// Nada aqui sabe de Colyseus: a sala chama `tick`, `list` e `claim`.

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
  /** Pontos candidatos: grade de 4 m dentro deste limite. */
  GRID: 4,
  SPAN: 56,
});

const r2 = (v) => Math.round(v * 100) / 100;

class MobDirector {
  /**
   * @param {object} o
   * @param {(x:number, z:number, radius:number) => boolean} o.isFree lugar livre para nascer
   * @param {() => number} [o.rng]
   * @param {number} [o.now] ms
   */
  constructor({ isFree, rng = Math.random, now = Date.now() }) {
    this.rng = rng;
    this.mobs = new Map();
    this.seq = 0;
    this.nextAt = now + this.between(MOBS.FIRST_MS);
    // Lugares possíveis (calculados uma vez: a planta do centro não muda na sala).
    this.spots = [];
    for (let x = -MOBS.SPAN; x <= MOBS.SPAN; x += MOBS.GRID) {
      for (let z = -MOBS.SPAN; z <= MOBS.SPAN; z += MOBS.GRID) {
        // Precisa caber a volta inteira em volta do ponto.
        if (isFree(x, z, MOBS.RADIUS + MOBS.WANDER_R)) this.spots.push({ x, z });
      }
    }
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

  /** Avança o relógio. `players` = posições de quem está a pé no centro. Devolve true se a lista mudou. */
  tick(now, players, dt) {
    let changed = false;
    for (const m of this.mobs.values()) {
      if (now - m.born >= MOBS.LIFE_MS) {
        this.mobs.delete(m.id);
        changed = true;
        continue;
      }
      m.a += (MOBS.WANDER_V / MOBS.WANDER_R) * m.dir * dt;
      m.x = m.cx + Math.sin(m.a) * MOBS.WANDER_R;
      m.z = m.cz + Math.cos(m.a) * MOBS.WANDER_R;
      // rumo = a tangente da volta
      m.facing = m.a + (m.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    if (now >= this.nextAt) {
      this.nextAt = now + this.between(MOBS.EVERY_MS);
      if (this.mobs.size < MOBS.MAX_ALIVE && this.spawn(now, players)) changed = true;
    }
    return changed;
  }

  spawn(now, players) {
    const ok = this.spots.filter(
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

  /** Alguém venceu o monstro `id` estando em (x, z): sai da cidade. Devolve o monstro ou null. */
  claim(id, x, z) {
    const m = this.get(id);
    if (!m) return null;
    if (Math.hypot(m.x - x, m.z - z) > MOBS.CLAIM_REACH) return null;
    this.mobs.delete(m.id);
    return m;
  }

  /** Teste e admin: invasão agora. */
  forceSpawn(now, players) {
    return this.spawn(now, players);
  }
}

module.exports = { MobDirector, MOBS, KINDS };
