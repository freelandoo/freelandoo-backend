// src/utils/meuMundoNoturnoBot.js — o COMPUTADOR do Rolê Noturno (regra do Alex, 2026-11-08:
// minijogo com sala espera 1 minuto e completa as vagas com computadores, como a Gincana).
//
// Roda na sala (src/realtime/meuMundoNoturno.js) com a cópia GERADA da regra
// (meuMundoNoturnoSim.js ← features/meu-mundo/noturno/sim/run.ts): a mesma rua da semente que
// os aparelhos recebem. O "cérebro" é o robô do harness (pipeline/noturno/harness/run-test.js):
// a cada 0,28 s olha 1,6 s à frente numa cópia rasa da corrida; se seguir reto bate, testa
// planos de até 3 ações (faixa, pulo, abaixar) e pega o primeiro que sobrevive. Para não
// correr para sempre, ele ERRA: em cada perigo, com uma chance que cresce com a velocidade e
// cai com a habilidade, não reage. Tudo sorteado por semente própria (repetível no teste).

const { Run, TUNING, speedAt, isRunPhase } = require("./meuMundoNoturnoSim");

const NONE = Object.freeze({ left: false, right: false, jump: false, down: false });
const ACTS = { n: NONE, l: { ...NONE, left: true }, r: { ...NONE, right: true }, j: { ...NONE, jump: true }, d: { ...NONE, down: true } };
const PLANS = ["n"];
for (const a of "lrjd") {
  PLANS.push(a);
  for (const b of "lrjd") {
    PLANS.push(a + b);
    for (const c of "lrjd") PLANS.push(a + b + c);
  }
}
const GAP = Math.round(0.28 / TUNING.step);
const HORIZON = Math.round(1.6 / TUNING.step);
/** Quanto tempo o computador fica sem reagir quando erra. */
const FREEZE = Math.round(0.7 / TUNING.step);
/** As mesmas bandeiras da pose do aparelho (noturno/engine/net.ts FLAG). */
const FLAG = { air: 1, power: 2, spin: 4, flip: 8, right: 16 };

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

/** Cópia rasa da corrida para olhar à frente (sem gerar rua nova). */
function clone(r) {
  const c = Object.assign(Object.create(Object.getPrototypeOf(r)), r);
  c.obstacles = r.obstacles.map((o) => ({ ...o }));
  c.coins = [];
  c.powers = r.powers.map((p) => ({ ...p }));
  c.generate = () => {};
  return c;
}

function survives(r, plan) {
  const c = clone(r);
  const ev = [];
  for (let i = 0; i < HORIZON; i++) {
    let a = NONE;
    if (i === 0) a = ACTS[plan[0]];
    else if (i === GAP && plan[1]) a = ACTS[plan[1]];
    else if (i === 2 * GAP && plan[2]) a = ACTS[plan[2]];
    ev.length = 0;
    c.step(a, ev);
    if (!c.alive) return false;
  }
  return true;
}

class NoturnoBot {
  /**
   * @param ride  veículo do computador (o desenho; a rua é a `street` da sala)
   * @param seed  semente da rua (a mesma dos aparelhos)
   * @param street curva da rua da sala
   * @param skill 0–1 (quanto mais, menos erra)
   * @param luck  semente dos erros
   * @param phase rota do Rolê 2.0 (a mesma da sala; sem ela, a Clássica)
   */
  constructor({ ride, seed, street, skill, luck, phase }) {
    this.run = new Run(ride, seed, street, isRunPhase(phase) ? phase : "classica");
    this.skill = Math.max(0, Math.min(1, skill));
    this.rnd = rng(luck);
    this.queue = [];
    this.wait = 0;
    this.acc = 0;
    this.ev = [];
    this.freeze = 0;
  }

  /** Chance de não reagir num perigo: cresce com a velocidade (rua mais difícil), cai com a habilidade. */
  missChance() {
    const v = this.run.v || speedAt(this.run.street, this.run.z);
    const fast = Math.max(0, Math.min(1, (v - 12) / 60));
    return (0.07 + 0.3 * (1 - this.skill)) * (0.4 + 1.6 * fast);
  }

  decide() {
    if (survives(this.run, "n")) return [];
    // errou: fica "travado" um instante (não reage a este perigo)
    if (this.rnd() < this.missChance()) {
      this.freeze = FREEZE;
      return [];
    }
    for (const p of PLANS) if (p !== "n" && survives(this.run, p)) return p.split("");
    return [];
  }

  /** Avança `dt` segundos de corrida. */
  advance(dt) {
    const r = this.run;
    if (!r.alive) return;
    this.acc += dt;
    while (this.acc >= TUNING.step && r.alive) {
      this.acc -= TUNING.step;
      if (this.freeze > 0) this.freeze -= 1;
      else if (this.wait <= 0) {
        if (!this.queue.length) this.queue = this.decide();
        this.wait = GAP;
      }
      const a = this.wait === GAP && this.queue.length ? ACTS[this.queue.shift()] : NONE;
      this.wait -= 1;
      this.ev.length = 0;
      r.step(a, this.ev);
    }
  }

  /** O que a sala guarda/manda (o mesmo formato da pose dos aparelhos). */
  pose() {
    const r = this.run;
    const f = (r.grounded ? 0 : FLAG.air) | (r.smashing ? FLAG.power : 0) | (r.trickKind === "spin" ? FLAG.spin : r.trickKind === "flip" ? FLAG.flip : 0) | (r.trickDir > 0 ? FLAG.right : 0);
    return { z: r.z, x: r.x, y: r.y, f, k: r.trickP || 0, score: r.score, coins: r.coinsGot, tricks: r.tricks, alive: r.alive, by: r.crashedBy || "" };
  }
}

module.exports = { NoturnoBot, rng };
