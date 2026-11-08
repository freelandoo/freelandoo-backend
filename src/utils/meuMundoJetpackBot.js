// src/utils/meuMundoJetpackBot.js — o COMPUTADOR do Jetpack (regra do Alex, 2026-11-08:
// sempre 4 no túnel — você e mais 3 —, espera de 1 minuto e as vagas vazias viram computadores).
//
// Roda na sala (src/realtime/meuMundoJetpack.js) com a cópia GERADA da regra do voo
// (meuMundoJetpackSim.js ← features/meu-mundo/jetpack/sim/{phases,flight}.ts): o mesmo túnel da
// semente e da fase que os aparelhos recebem. Quem MOVE o computador é a classe Flight (a
// mesma física do aparelho, passo a passo igual ao `lite` daqui — conferido no teste).
//
// Quem DECIDE é a busca de ALCANCE do robô do harness (mm3d-75, a que provou que todo túnel
// tem caminho): camadas de 0,1 s com as 6 ações (lado × propulsor), um estado por célula
// (x, y, vx, vy; fica o de mais combustível), no máximo CAP por camada. A busca roda À FRENTE
// do voo (~2,5 s) e o computador segue o melhor caminho que já se sabe que passa; a cada
// camada, a árvore é podada para os descendentes de onde ele está (compromisso, sem "pulo").
// Para não voar para sempre, cada computador sorteia a distância em que "cansa" (pela
// habilidade): dali em diante a busca para e ele bate logo depois. Se a busca não acha
// saída antes disso, ele bate ali mesmo (como um jogador que errou o caminho).

const { Flight, TUNING, TUNNEL, hits, speedAt } = require("./meuMundoJetpackSim");
const { rng } = require("./meuMundoNoturnoBot");

const { W, H } = TUNNEL;
const ACTS = [
  [0, true],
  [0, false],
  [-1, true],
  [-1, false],
  [1, true],
  [1, false],
];
/** Passos da regra por camada (0,1 s). */
const LAYER = Math.round(0.1 / TUNING.step);
/** Estados por camada (custo × qualidade). */
const CAP = 160;
/** Camadas que a busca mantém à frente do voo (~2,5 s). */
const AHEAD = 25;
/** Teto de camadas novas por chamada (o resto fica para o próximo quadro da sala). */
const PER_CALL = 6;
/** Bandeiras da pose do aparelho (jetpack/engine/net.ts FLAG). */
const FLAG = { thrust: 1, empty: 2 };

/** Passo leve da busca: o MESMO da Flight.step (sem eventos). */
function lite(c, s, side, thrust, k) {
  const dt = TUNING.step;
  s.t += dt;
  const z0 = s.z;
  s.z += speedAt(s.z, k) * dt;
  const want = side * TUNING.side;
  const m = TUNING.sideAcc * dt;
  s.vx += Math.max(-m, Math.min(m, want - s.vx));
  if (!s.armed && (thrust || s.t > TUNING.hoverS)) s.armed = true;
  let th = thrust && s.fuel > 0;
  if (!s.armed) {
    s.vy += ((TUNING.startY - s.y) * 6 - s.vy * 4) * dt;
    th = s.y < TUNING.startY;
  } else s.vy += ((th ? TUNING.thrust : 0) - TUNING.gravity) * dt;
  s.vy -= s.vy * TUNING.drag * dt;
  s.vy = Math.max(TUNING.vyDown, Math.min(TUNING.vyUp, s.vy));
  s.fuel = Math.max(0, s.fuel - (TUNING.fuelIdle + (th ? TUNING.fuelBurn : 0)) * dt);
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  c.ensure(s.z + 320);
  for (const can of c.cans) {
    if (can.z > s.z + TUNING.pick.z) break;
    if (can.taken || s.taken.has(can.id) || can.z < z0 - TUNING.pick.z) continue;
    if (Math.abs(can.x - s.x) < TUNING.pick.x && Math.abs(can.y - s.y) < TUNING.pick.y) {
      s.taken.add(can.id);
      s.cans++;
      s.fuel = Math.min(TUNING.fuelMax, s.fuel + TUNING.fuelGain);
    }
  }
  if (Math.abs(s.x) + TUNING.hx > W / 2 || s.y - TUNING.hy < 0 || s.y + TUNING.hy > H) return false;
  for (const o of c.obstacles) {
    if (o.z > s.z + TUNING.hz) break;
    if (o.z + o.d < s.z - TUNING.hz) continue;
    if (hits(o, s.t, s.x, s.y)) return false;
  }
  return true;
}
const clone = (s) => ({ ...s, taken: new Set(s.taken) });
/** Melhor folha: combustível, galões e longe das bordas. */
const value = (s) => s.fuel + s.cans * 25 - Math.abs(s.y - H / 2) * 4 - Math.abs(s.x) * 3;

class JetpackBot {
  /**
   * @param seed  semente do túnel (a mesma dos aparelhos)
   * @param phase fase do túnel
   * @param k     fator de velocidade do computador (como o speedFactor de quem joga)
   * @param skill 0–1 (quanto mais, mais longe "cansa")
   * @param luck  semente do sorteio
   */
  constructor({ seed, phase, k, skill, luck }) {
    this.k = k;
    this.flight = new Flight(seed, k, phase);
    const rnd = rng(luck);
    const sk = Math.max(0, Math.min(1, skill));
    // distância em que cansa: fraco ~300–900 m, forte ~1,2–3 km
    this.tiredAt = (300 + 1700 * sk) * (0.6 + 0.9 * rnd());
    const f = this.flight;
    this.cur = { s: { x: f.x, y: f.y, z: f.z, vx: f.vx, vy: f.vy, fuel: f.fuel, t: f.t, armed: f.armed, taken: new Set(), cans: 0 }, parent: null, act: 0, depth: 0 };
    this.frontier = [this.cur];
    this.stuck = false;
    this.act = ACTS[1];
    this.inLayer = LAYER;
    this.acc = 0;
    this.ev = [];
  }

  /** Mais uma camada da busca a partir da fronteira. */
  extend() {
    if (this.stuck || !this.frontier.length) return;
    if (this.frontier[0].s.z > this.tiredAt) {
      this.stuck = true;
      return;
    }
    const c = this.flight.course;
    const cells = new Map();
    for (const node of this.frontier) {
      for (let a = 0; a < ACTS.length; a++) {
        const s = clone(node.s);
        let ok = true;
        for (let j = 0; j < LAYER && ok; j++) ok = lite(c, s, ACTS[a][0], ACTS[a][1], this.k);
        if (!ok) continue;
        const key = `${Math.round(s.x / 0.45)}|${Math.round(s.y / 0.3)}|${Math.round(s.vx / 2.5)}|${Math.round(s.vy / 2)}`;
        const was = cells.get(key);
        if (!was || s.fuel > was.s.fuel) cells.set(key, { s, parent: node, act: a, depth: node.depth + 1 });
      }
    }
    let next = [...cells.values()];
    if (!next.length) {
      // sem saída daqui: o voo segue a melhor folha que tinha e bate
      this.stuck = true;
      return;
    }
    if (next.length > CAP) {
      // amostra ESPALHADA (como o robô do harness): cortar só pelos "melhores" perde as saídas
      next.sort((x, y) => y.s.fuel - x.s.fuel);
      const keep = [];
      for (let j = 0; j < next.length; j += next.length / CAP) keep.push(next[Math.floor(j)]);
      next = keep;
    }
    this.frontier = next;
  }

  /** A ação da próxima camada: o primeiro passo do melhor caminho que sai de onde ele está. */
  choose() {
    const want = this.cur.depth + 1;
    let best = null;
    for (const n of this.frontier) if (!best || value(n.s) > value(best.s)) best = n;
    if (!best || best.depth < want) return ACTS[1];
    let n = best;
    while (n.depth > want) n = n.parent;
    this.cur = n;
    // poda: só os descendentes de onde ele está agora
    this.frontier = this.frontier.filter((f) => {
      let p = f;
      while (p.depth > want) p = p.parent;
      return p === n;
    });
    return ACTS[n.act];
  }

  advance(dt) {
    const f = this.flight;
    if (!f.alive) return;
    for (let i = 0; i < PER_CALL && !this.stuck && this.frontier.length && this.frontier[0].depth - this.cur.depth < AHEAD; i++) this.extend();
    this.acc += dt;
    while (this.acc >= TUNING.step && f.alive) {
      this.acc -= TUNING.step;
      if (this.inLayer >= LAYER) {
        this.act = this.choose();
        this.inLayer = 0;
      }
      this.inLayer += 1;
      this.ev.length = 0;
      f.step({ side: this.act[0], thrust: this.act[1] }, this.ev);
    }
  }

  pose() {
    const f = this.flight;
    return { z: f.z, x: f.x, y: f.y, f: (f.thrusting ? FLAG.thrust : 0) | (f.fuel <= 0 ? FLAG.empty : 0), score: f.score, cans: f.cans, alive: f.alive, by: f.crashedBy || "" };
  }
}

module.exports = { JetpackBot, lite };
