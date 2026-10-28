// src/utils/meuMundoBoxe.js — MEU MUNDO 3D: a luta da Arena de Boxe (mm3d-43 → mm3d-44).
//
// mm3d-44 (pedido do Alex): "faça com que a pessoa possa controlar seu
// personagem e ter um botão de ataque, para fazer os combos que você vai mandar
// em aleatório". A luta deixou de ser calculada de uma vez: é uma PARTIDA AO
// VIVO que a sala (src/realtime/meuMundoBoxe.js) roda a TICK. O aparelho manda
// o joystick (direção no chão), o ATAQUE (um combo sorteado de PIECES) e a
// ESQUIVA; o servidor anda com os dois, decide cada pancada (alcance, bloqueio,
// esquiva, limpo), as quedas, a contagem e o fim. O computador é a IA daqui.
//
// O que a VIDA decide continua valendo (fighter(): força, velocidade,
// inteligência, massa magra, gordura, energia, saciedade, estresse, sono,
// saúde): força = dano; velocidade = mão (o combo toca mais rápido) e pernas;
// reflexo = guarda que segura sozinha e a janela da esquiva; fôlego = quanto
// aguenta socar; queixo = quanto aguenta apanhar e levantar.
//
// Regras (jogo, não manual de boxe):
//  • 3 rounds de ROUND_S, BREAK_S de intervalo (o canto devolve um pouco de
//    sangue e fôlego; cada um vai para o seu canto).
//  • Golpe chega no quadro da pancada do clipe (PIECES, medido nas animações):
//    fora do alcance = erro; defensor esquivando (janela) = escapou; parado na
//    guarda = pode BLOQUEAR sozinho (pelo reflexo e fôlego, leva uma lasca);
//    socando ou atordoado = toma cheio (e às vezes LIMPO, ×1,6).
//  • Sangue 0 = QUEDA. Contagem de 1 a 10 (o relógio do round para); levanta
//    pelo queixo — e quem está no chão pode apertar ATACAR para levantar mais
//    rápido; 3 quedas = nocaute técnico.
//  • Sem queda decisiva = pontos (round a round, 10 × 9; queda tira 1).
//  • Fôlego: cada pancada gasta, a esquiva gasta; volta parado. Cansado = mão
//    lenta, pernas lentas e menos dano; sem fôlego não ataca.

const BOXE = Object.freeze({
  ROUNDS: 3,
  ROUND_S: 60,
  BREAK_S: 10,
  TICK: 0.05,
  /** Meia largura útil do ringue (m): as cordas ficam em ±3,1. */
  RING: 2.7,
  /** Distância de luta que o computador procura (centro a centro, m). */
  RANGE: 0.95,
  /** Alcance da pancada (centro a centro, m). */
  REACH: 1.22,
  /** Ninguém atravessa ninguém (m). */
  MIN_SEP: 0.72,
  /** Uma contagem do árbitro (s). */
  COUNT_S: 0.75,
  /** Tempo da queda até a contagem começar (s). */
  FALL_S: 1.3,
  /** Kip Up do chão até em pé (s). */
  RISE_S: 1.65,
  /** Depois de levantar, o árbitro limpa as luvas (s). */
  RESUME_S: 0.6,
  MAX_KD: 3,
  /** Escala geral do dano (calibrada: parelho médio derruba em ~20 golpes). */
  DMG: 0.5,
  /** Intenção de andar vale por este tempo sem nova mensagem (s). */
  INPUT_TTL: 0.6,
  /** Apresentação antes do 1º sino (s; a sala pode mudar). */
  INTRO_S: 5,
});

/** Quadros por segundo das animações (build_boxe_mocap.py). */
const FPS = 30;

/**
 * Pedaços de combo: o trecho [from, to] (quadros) do clipe e as pancadas
 * [quadro, mão, peso]. Quadros medidos nas animações da pasta "boxe" do Alex
 * (maior extensão da mão). Um ATAQUE = 1 a 3 pedaços sorteados, em sequência.
 */
const PIECES = Object.freeze([
  { clip: "BJab", n: 46, from: 3, to: 30, hits: [[13, 0, 0.75]] },
  { clip: "BBox0", n: 64, from: 3, to: 34, hits: [[13, 0, 0.8], [21, 1, 1]] },
  { clip: "BBox1", n: 65, from: 8, to: 36, hits: [[21, 1, 1.2]] },
  { clip: "BBox2", n: 53, from: 4, to: 30, hits: [[14, 0, 1.05]] },
  { clip: "BBox3", n: 67, from: 10, to: 36, hits: [[22, 1, 1]] },
  { clip: "BBox4", n: 67, from: 10, to: 38, hits: [[22, 0, 1.2]] },
  { clip: "BBox5", n: 61, from: 4, to: 54, hits: [[14, 0, 0.8], [46, 0, 0.9]] },
  { clip: "BBag", n: 98, from: 8, to: 50, hits: [[15, 0, 0.6], [24, 0, 0.6], [35, 1, 0.65], [44, 1, 0.65]] },
  { clip: "BBag", n: 98, from: 48, to: 86, hits: [[56, 0, 0.6], [63, 1, 0.65], [70, 0, 0.6], [77, 1, 0.7]] },
]);
/** Sorteio dos pedaços (os fortes e os do saco aparecem menos). */
const PIECE_W = [3, 3, 2.2, 2, 2, 1.8, 1.2, 1, 1];
const MAX_PIECES = 3;
/** Esquiva: trecho do "Dodging", janela em que nada pega (s, no ritmo 1) e custo. */
const DODGE = Object.freeze({ clip: "BDodge", n: 68, from: 1, to: 34, open: 0.05, close: 0.72, stam: 6 });

/** Reações (ações que a sala impõe): clipe, trecho e duração (s). */
const REACT = Object.freeze({
  block: { clip: "BHitLite", n: 33, from: 1, to: 12, dur: 0.3, stun: 0.12 },
  light: { clip: "BHitLite", n: 33, from: 1, to: 22, dur: 0.5, stun: 0.3 },
  heavy: { clip: "BHit", n: 44, from: 1, to: 40, dur: 0.9, stun: 0.6 },
  stagger: { clip: "BStagger", n: 74, from: 1, to: 60, dur: 1.6, stun: 1.1 },
});

/** Códigos das ações no estado (o aparelho tem a mesma lista). */
const ACT = Object.freeze({ NONE: 0, COMBO: 1, DODGE: 2, LIGHT: 3, HEAVY: 4, STAGGER: 5, BLOCK: 6, DOWN: 7, RISE: 8, WIN: 9, LOSE: 10, WARM: 11 });

/** Estratégia do computador (o jogador agora luta ele mesmo). */
const STRATEGIES = Object.freeze({
  aggressive: { attack: 1.35, guard: 0.75, power: 1.1 },
  balanced: { attack: 1, guard: 1, power: 1 },
  defensive: { attack: 0.7, guard: 1.35, power: 0.95 },
});

/** Adversários do computador: escala dos números do jogador e a mão da IA. */
const TIERS = Object.freeze({
  easy: { mul: 0.78, purse: 15, ai: 0.7 },
  even: { mul: 1, purse: 40, ai: 1 },
  hard: { mul: 1.2, purse: 90, ai: 1.25 },
});

/** Eventos (o aparelho tem a mesma lista): [t, código, quem, …]. */
const EV = Object.freeze({
  BELL: 0, // [t, 0, round]
  BREAK: 1, // [t, 1, round]
  PUNCH: 2, // [t, 2, quem bateu, res, dano, mão]
  DOWN: 3, // [t, 3, quem caiu, kd]
  COUNT: 4, // [t, 4, quem, n]
  UP: 5, // [t, 5, quem]
  KO: 6, // [t, 6, quem caiu, tko?1:0]
  STUN: 7, // [t, 7, quem]
  END: 8, // [t, 8, vencedor (-1 empate)]
});
const RES = Object.freeze({ MISS: 0, BLOCK: 1, SLIP: 2, HIT: 3, CLEAN: 4 });

/** Fases (estado). */
const PH = Object.freeze({ INTRO: 0, ROUND: 1, BREAK: 2, COUNT: 3, END: 4 });

/** Onde cada um fica na apresentação e no intervalo. */
const CORNERS = Object.freeze([
  { x: -1.6, z: -0.4 },
  { x: 1.6, z: 0.4 },
]);

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const sq = (v) => Math.sqrt(clamp(v));

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══ O LUTADOR ═══

/**
 * Números do lutador a partir da vida (`stats` = Life.fightStats). Devolve
 * as notas (0–1+) que a luta usa, as notas de mostrar (0–100) e as condições
 * (o que está ajudando ou atrapalhando hoje).
 */
function fighter(stats, strategy = "balanced") {
  const st = stats || {};
  const str = clamp((st.strength || 0) / 1000);
  const spd = clamp((st.speed || 0) / 1000);
  const int = clamp((st.intelligence || 0) / 1000);
  const lean = clamp(((st.leanKg || 55) - 45) / 30);
  const fat = st.fatPct || 15;
  const energy = st.energy ?? 80;
  const satiety = st.satiety ?? 60;
  const stress = st.stress ?? 20;
  const health = st.health ?? 90;
  const awake = st.awakeH ?? 4;
  const endurance = st.endurance ?? 1;

  const tiredF = 0.68 + 0.32 * clamp(energy / 60);
  const hungerF = satiety < 40 ? 0.72 + 0.28 * clamp(satiety / 40) : satiety > 92 ? 0.9 : 1;
  const sleepF = 1 - Math.min(0.25, Math.max(0, awake - 16) * 0.02);
  const stressF = 1 - Math.min(0.24, Math.max(0, stress - 60) * 0.006);
  const healthF = 0.6 + 0.4 * clamp(health / 80);
  const fatF = fat > 22 ? Math.max(0.72, 1 - (fat - 22) * 0.012) : 1;

  const sg = STRATEGIES[strategy] || STRATEGIES.balanced;
  const p = st.personality || {};
  const f = {
    power: (0.3 + 0.7 * sq(str)) * (0.78 + 0.22 * lean) * Math.sqrt(hungerF * healthF),
    hands: (0.35 + 0.65 * sq(spd)) * tiredF * fatF,
    reflex: (0.3 + 0.55 * sq(spd) + 0.15 * sq(int)) * tiredF * sleepF,
    accuracy: (0.55 + 0.25 * sq(int) + 0.2 * sq(spd)) * stressF,
    engine: (0.5 + 0.3 * sq(spd) + 0.2 * sq(str)) * endurance * tiredF * hungerF * healthF * fatF,
    chin: (0.55 + 0.25 * lean + 0.2 * sq(str)) * healthF * (fat > 22 ? 1.03 : 1),
    aggression: clamp(0.4 + 0.25 * (p.optimism ?? 0.5) + 0.15 * (1 - (p.anxiety ?? 0.5)) + (stress > 70 ? 0.1 : 0)),
    strategy: STRATEGIES[strategy] ? strategy : "balanced",
    sg,
  };
  const pct = (v, lo, hi) => Math.round(100 * clamp((v - lo) / (hi - lo)));
  f.view = {
    power: pct(f.power, 0.2, 1),
    speed: pct(f.hands, 0.25, 1),
    defense: pct(f.reflex, 0.2, 1),
    stamina: pct(f.engine, 0.3, 1),
    chin: pct(f.chin, 0.35, 1.03),
  };
  const cond = [];
  if (satiety < 25) cond.push("hungry");
  else if (satiety < 40) cond.push("peckish");
  else if (satiety > 92) cond.push("stuffed");
  else cond.push("fed");
  if (energy < 30) cond.push("exhausted");
  else if (energy < 60) cond.push("tired");
  else cond.push("rested");
  if (awake > 16) cond.push("sleepy");
  if (stress > 60) cond.push("stressed");
  if (health < 60) cond.push("hurt");
  if (fat > 22) cond.push("heavy");
  f.conditions = cond;
  return f;
}

/**
 * Adversário do computador: os números do jogador × o nível, com sorte
 * (±12%) e sempre alimentado e descansado (é um profissional da casa).
 */
function cpuStats(base, tier, seed) {
  const tr = TIERS[tier] || TIERS.even;
  const r = rng(seed ^ 0x51ed);
  const j = () => 0.88 + r() * 0.24;
  const at = (v, floor) => Math.round(Math.min(1000, Math.max(floor, (v || 0) * tr.mul * j() + (tier === "hard" ? 12 : tier === "easy" ? -4 : 6))));
  return {
    strength: at(base.strength, 10),
    speed: at(base.speed, 12),
    intelligence: at(base.intelligence, 10),
    leanKg: Math.max(46, Math.min(90, (base.leanKg || 55) * (0.92 + (tr.mul - 1) * 0.3) * j())),
    fatPct: 10 + r() * 8,
    energy: 85,
    satiety: 65,
    stress: 25,
    health: 95,
    awakeH: 4,
    endurance: 1,
    personality: { optimism: r(), anxiety: r() },
  };
}

// ═══ A PARTIDA ═══

/** Duração (s, no ritmo 1) de um pedaço. */
const pieceDur = (p) => (PIECES[p].to - PIECES[p].from) / FPS;

/** Combo válido vindo do aparelho (1 a 3 pedaços conhecidos) ou null. */
function validCombo(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PIECES) return null;
  const out = list.map((v) => Number(v));
  return out.every((v) => Number.isInteger(v) && v >= 0 && v < PIECES.length) ? out : null;
}

/** Sorteia um combo de `n` pedaços (sem repetir o mesmo pedaço em seguida). */
function randomCombo(R, n) {
  const out = [];
  const sum = PIECE_W.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let tries = 0; tries < 4; tries++) {
      let r = R() * sum;
      k = 0;
      while (k < PIECE_W.length - 1 && (r -= PIECE_W[k]) > 0) k++;
      if (k !== out[out.length - 1]) break;
    }
    out.push(k);
  }
  return out;
}

/**
 * Uma luta ao vivo. `corners` = [{ stats, cpu, tier, strategy }, …].
 * A sala chama input() com o que chega dos aparelhos, step() a cada TICK e
 * snapshot() para mandar; `ev` acumula os eventos desde o último snapshot.
 */
class Match {
  constructor(corners, seed, opts = {}) {
    this.R = rng(seed);
    this.seed = seed;
    this.intro = opts.intro ?? BOXE.INTRO_S;
    this.t = -this.intro;
    this.phase = PH.INTRO;
    this.round = 1;
    this.clock = BOXE.ROUND_S;
    this.breakLeft = 0;
    this.count = null; // { who, n, next, will, need, riseAt }
    this.result = null;
    this.ev = [];
    this.cards = [];
    this.roundPts = [0, 0];
    this.kdRound = [0, 0];
    this.activeS = 0;
    this.F = corners.map((c, i) => {
      const f = fighter(c.stats, c.strategy);
      return {
        i,
        f,
        cpu: !!c.cpu,
        ai: (TIERS[c.tier] || TIERS.even).ai,
        x: CORNERS[i].x,
        z: CORNERS[i].z,
        face: 0,
        kx: 0,
        kz: 0,
        blood: 100,
        bloodMax: 100,
        stam: 100,
        stamMax: 100,
        act: { code: ACT.WARM, seq: 1, t0: this.t, rate: 1, cid: 0, pieces: [], hits: [], end: Infinity, open: 0, close: 0 },
        stun: 0,
        down: false,
        kd: 0,
        move: { x: 0, z: 0, at: -Infinity },
        /** mm3d-45: posição que o aparelho mandou (o movimento é dele; a sala só limita). */
        pos: null,
        taps: 0,
        tally: { thrown: 0, landed: 0, kd: 0, dmg: 0, taken: 0 },
        aiCool: 0.8 + this.R() * 0.6,
        aiDir: { x: 0, z: 0 },
        aiSide: this.R() < 0.5 ? -1 : 1,
        aiSeen: 0,
        aiDodgeAt: null,
      };
    });
    this.seq = 1;
  }

  // ── números de cada um agora ───────────────────────────────────────────────
  stamF(A) {
    return clamp(A.stam / 100);
  }
  /** Ritmo do combo (mão rápida, fôlego). */
  atkRate(A) {
    return r3(clamp(0.85 + 0.55 * A.f.hands, 0.8, 1.45) * (0.72 + 0.28 * this.stamF(A)));
  }
  /** Pernas (m/s). */
  footSpeed(A) {
    return r3(1.55 * (0.75 + 0.45 * A.f.hands) * (0.6 + 0.4 * this.stamF(A)));
  }
  canAct(A) {
    if (this.phase !== PH.ROUND || A.down || A.stun > 0) return false;
    const a = A.act;
    return a.code === ACT.NONE || this.t >= a.end;
  }

  setAct(A, code, extra = {}) {
    A.act = { code, seq: ++this.seq, t0: r3(this.t), rate: 1, cid: 0, pieces: [], hits: [], end: Infinity, open: 0, close: 0, ...extra };
    return A.act;
  }

  // ── entrada ───────────────────────────────────────────────────────────────

  /**
   * Do aparelho: `p` = [x, z] onde o lutador está no aparelho (mm3d-45: o
   * movimento é do aparelho, a sala só não deixa passar da velocidade
   * possível), `m` = [x, z] direção no chão (|m| ≤ 1; sem `p`), `a` = combo pedido
   * (lista de pedaços) com `c` = id do aparelho, `d` = esquivar, `k` = toques
   * para levantar. Lixo é ignorado.
   */
  input(slot, msg) {
    const A = this.F[slot];
    if (!A || A.cpu || !msg || typeof msg !== "object") return;
    if (Array.isArray(msg.m) && msg.m.length === 2) {
      let x = Number(msg.m[0]);
      let z = Number(msg.m[1]);
      if (Number.isFinite(x) && Number.isFinite(z)) {
        const n = Math.hypot(x, z);
        if (n > 1) (x /= n), (z /= n);
        A.move = { x, z, at: this.t };
      }
    }
    if (Array.isArray(msg.p) && msg.p.length === 2) {
      const x = Number(msg.p[0]);
      const z = Number(msg.p[1]);
      if (Number.isFinite(x) && Number.isFinite(z)) A.pos = { x: clamp(x, -BOXE.RING, BOXE.RING), z: clamp(z, -BOXE.RING, BOXE.RING), at: this.t };
    }
    if (msg.a !== undefined) this.attack(A, validCombo(msg.a), Number(msg.c) >>> 0);
    if (msg.d) this.dodge(A);
    if (msg.k) A.taps = Math.min(12, A.taps + Math.min(4, Math.max(0, Number(msg.k) | 0)));
  }

  attack(A, combo, cid = 0) {
    if (!this.canAct(A) || A.stam < 6) return false;
    const pieces = combo || randomCombo(this.R, 1 + Math.floor(this.R() * MAX_PIECES));
    const rate = this.atkRate(A);
    const hits = [];
    let off = 0;
    for (const p of pieces) {
      const P = PIECES[p];
      for (const [fr, hand, w] of P.hits) hits.push({ at: r3(this.t + (off + (fr - P.from) / FPS) / rate), hand, w });
      off += pieceDur(p);
    }
    this.setAct(A, ACT.COMBO, { rate, cid, pieces, hits, end: r3(this.t + off / rate) });
    return true;
  }

  dodge(A) {
    if (!this.canAct(A) || A.stam < DODGE.stam) return false;
    const rate = r3(1 + 0.35 * A.f.reflex);
    A.stam = Math.max(0, A.stam - DODGE.stam * (1.1 - 0.3 * A.f.engine));
    this.setAct(A, ACT.DODGE, {
      rate,
      open: r3(this.t + DODGE.open / rate),
      close: r3(this.t + (DODGE.close / rate) * (0.85 + 0.3 * A.f.reflex)),
      end: r3(this.t + (DODGE.to - DODGE.from) / FPS / rate),
    });
    return true;
  }

  // ── a pancada ─────────────────────────────────────────────────────────────

  land(A, D, hit) {
    const out = [r2(this.t), EV.PUNCH, A.i, RES.MISS, 0, hit.hand];
    A.tally.thrown++;
    const cost = 4.2 * hit.w * (1.1 - 0.3 * A.f.engine);
    A.stam = Math.max(0, A.stam - cost);
    A.stamMax = Math.max(55, A.stamMax - cost * 0.06);
    const dist = Math.hypot(A.x - D.x, A.z - D.z);
    const whiff = (1 - A.f.accuracy) * 0.3;
    if (D.down || dist > BOXE.REACH || this.R() < whiff) {
      A.stam = Math.max(0, A.stam - cost * 0.4);
      this.ev.push(out);
      return;
    }
    const da = D.act;
    if (da.code === ACT.DODGE && this.t >= da.open && this.t <= da.close) {
      out[3] = RES.SLIP;
      A.stam = Math.max(0, A.stam - cost * 0.3);
      this.ev.push(out);
      return;
    }
    const sf = this.stamF(D);
    const guarding = (da.code === ACT.NONE || this.t >= da.end || da.code === ACT.BLOCK) && D.stun <= 0;
    const blockP = guarding ? clamp((0.18 + 0.5 * D.f.reflex) * (0.5 + 0.5 * sf) * D.f.sg.guard, 0, 0.6) : 0;
    let dmg = (BOXE.DMG * 6.2 * hit.w * A.f.power * A.f.sg.power * (0.55 + 0.45 * this.stamF(A)) * (0.85 + this.R() * 0.3)) / D.f.chin;
    if (this.R() < blockP) {
      const chip = Math.max(0.3, dmg * 0.18);
      D.blood = Math.max(0.5, D.blood - chip);
      D.stam = Math.max(0, D.stam - hit.w * 2);
      D.tally.taken += chip;
      out[3] = RES.BLOCK;
      out[4] = r1(chip);
      this.ev.push(out);
      this.react(D, "block", A, 0.05);
      return;
    }
    const cleanP = 0.06 + 0.22 * (1 - sf) + (D.stun > 0 ? 0.18 : 0) + (da.code === ACT.COMBO && this.t < da.end ? 0.1 : 0);
    const clean = this.R() < cleanP;
    if (clean) dmg *= 1.6;
    dmg = Math.max(0.5, dmg);
    D.blood = Math.max(0, D.blood - dmg);
    D.stam = Math.max(0, D.stam - dmg * 0.35);
    D.bloodMax = Math.max(40, D.bloodMax - dmg * 0.15);
    A.tally.landed++;
    A.tally.dmg += dmg;
    D.tally.taken += dmg;
    this.roundPts[A.i] += dmg * (clean ? 1.3 : 1);
    out[3] = clean ? RES.CLEAN : RES.HIT;
    out[4] = r1(dmg);
    this.ev.push(out);
    if (D.blood <= 0) return; // a queda vem no fim do passo
    // um socão no meio do combo dele corta o combo; pancadinha não
    const kind = clean && dmg >= 8 ? "stagger" : dmg >= 6 || clean ? "heavy" : "light";
    const interrupt = !(da.code === ACT.COMBO && this.t < da.end && dmg < 2);
    if (interrupt) this.react(D, kind, A, Math.min(0.35, dmg * 0.03));
    if (kind === "stagger") this.ev.push([r2(this.t), EV.STUN, D.i]);
  }

  react(D, kind, A, push) {
    const r = REACT[kind];
    this.setAct(D, kind === "block" ? ACT.BLOCK : kind === "light" ? ACT.LIGHT : kind === "heavy" ? ACT.HEAVY : ACT.STAGGER, { end: r3(this.t + r.dur) });
    D.stun = Math.max(D.stun, r.stun);
    const dx = D.x - A.x;
    const dz = D.z - A.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = (kind === "stagger" ? 1.6 : 1) * push * 6;
    D.kx += (dx / d) * k;
    D.kz += (dz / d) * k;
  }

  // ── o passo ───────────────────────────────────────────────────────────────

  step() {
    const T = BOXE.TICK;
    this.t = r3(this.t + T);
    if (this.phase === PH.END) {
      this.walk(T, false);
      return;
    }
    if (this.phase === PH.INTRO) {
      if (this.t >= 0) this.bell(1);
      return;
    }
    if (this.phase === PH.BREAK) {
      this.breakLeft -= T;
      this.walk(T, true);
      if (this.breakLeft <= 0) this.bell(this.round + 1);
      return;
    }
    if (this.phase === PH.COUNT) {
      this.counting();
      this.walk(T, false);
      return;
    }
    // round
    this.clock -= T;
    this.activeS += T;
    const order = this.R() < 0.5 ? [0, 1] : [1, 0];
    for (const i of order) {
      const A = this.F[i];
      const D = this.F[1 - i];
      if (A.stun > 0) A.stun = Math.max(0, A.stun - T);
      if (A.cpu) this.ai(A, D, T);
      const a = A.act;
      if (a.code === ACT.COMBO) {
        while (a.hits.length && this.t >= a.hits[0].at - 1e-9) this.land(A, D, a.hits.shift());
      }
      if (a.code !== ACT.NONE && a.code !== ACT.DOWN && this.t >= a.end) A.act = { ...a, code: ACT.NONE, hits: [] };
    }
    this.walk(T, false);
    this.regen(T);
    for (const D of this.F) {
      if (D.blood <= 0 && !D.down) {
        this.knockdown(D, this.F[1 - D.i]);
        return;
      }
    }
    if (this.clock <= 1e-9) this.endRound();
  }

  regen(T) {
    for (const A of this.F) {
      const busy = A.act.code !== ACT.NONE && this.t < A.act.end;
      const still = Math.hypot(A.move.x, A.move.z) < 0.2;
      const r = A.f.engine * (busy ? 1.2 : still ? 7 : 4.5) * (0.7 + 0.3 * clamp(A.blood / 60));
      A.stam = Math.min(A.stamMax, A.stam + r * T);
    }
  }

  /** Pernas: o joystick (ou a IA), o avanço no combo, o empurrão e as cordas. */
  walk(T, toCorner) {
    for (const A of this.F) {
      const D = this.F[1 - A.i];
      let vx = 0;
      let vz = 0;
      if (toCorner || this.phase === PH.END || this.phase === PH.COUNT) {
        if (toCorner) {
          const dx = CORNERS[A.i].x - A.x;
          const dz = CORNERS[A.i].z - A.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.05) (vx = (dx / d) * Math.min(1.2, d / T)), (vz = (dz / d) * Math.min(1.2, d / T));
        } else if (this.phase === PH.COUNT && this.count && this.count.who !== A.i) {
          // quem derrubou vai para longe (canto neutro)
          const dx = A.x - D.x;
          const dz = A.z - D.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d < 2) (vx = (dx / d) * 1.1), (vz = (dz / d) * 1.1);
        }
      } else if (!A.down && !A.cpu && A.pos && this.t - A.pos.at <= BOXE.INPUT_TTL) {
        // a posição do aparelho, até onde as pernas (e um empurrão) alcançam neste passo
        const dx = A.pos.x - A.x;
        const dz = A.pos.z - A.z;
        const d = Math.hypot(dx, dz);
        const max = (this.footSpeed(A) * 1.4 + 1.6) * T + 0.01;
        const k = d > max ? max / d : 1;
        A.x += dx * k;
        A.z += dz * k;
        A.kx = A.kz = 0;
      } else if (!A.down) {
        const fs = this.footSpeed(A) * (A.stun > 0 ? 0.3 : 1);
        const a = A.act;
        const acting = a.code !== ACT.NONE && this.t < a.end;
        const m = A.cpu ? A.aiDir : this.t - A.move.at <= BOXE.INPUT_TTL ? A.move : { x: 0, z: 0 };
        const k = acting ? (a.code === ACT.DODGE ? 0.35 : 0.2) : 1;
        vx = m.x * fs * k;
        vz = m.z * fs * k;
        // no combo, entra no golpe
        if (a.code === ACT.COMBO && acting) {
          const dx = D.x - A.x;
          const dz = D.z - A.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d > BOXE.RANGE) (vx += (dx / d) * 0.9), (vz += (dz / d) * 0.9);
        }
      }
      A.x += (vx + A.kx) * T;
      A.z += (vz + A.kz) * T;
      const decay = Math.exp(-7 * T);
      A.kx *= decay;
      A.kz *= decay;
      A.x = clamp(A.x, -BOXE.RING, BOXE.RING);
      A.z = clamp(A.z, -BOXE.RING, BOXE.RING);
    }
    this.separate();
    for (const A of this.F) {
      const D = this.F[1 - A.i];
      A.face = Math.atan2(D.x - A.x, D.z - A.z);
    }
  }

  /** Ninguém atravessa ninguém — nem encurralado nas cordas (escorrega ao longo delas). */
  separate() {
    const [a, b] = this.F;
    const RING = BOXE.RING;
    for (let pass = 0; pass < 3; pass++) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= BOXE.MIN_SEP - 1e-9) return;
      let ux = d > 1e-6 ? dx / d : 1;
      let uz = d > 1e-6 ? dz / d : 0;
      if (pass === 2) {
        // os dois presos: escorrega pela corda (perpendicular à linha)
        const k = ux;
        ux = -uz;
        uz = k;
      }
      const push = (BOXE.MIN_SEP - d) / (pass === 0 ? 2 : 1);
      if (pass === 0) {
        a.x = clamp(a.x - ux * push, -RING, RING);
        a.z = clamp(a.z - uz * push, -RING, RING);
      }
      b.x = clamp(b.x + ux * push, -RING, RING);
      b.z = clamp(b.z + uz * push, -RING, RING);
      if (pass === 1 && Math.hypot(b.x - a.x, b.z - a.z) < BOXE.MIN_SEP - 1e-9) {
        a.x = clamp(a.x - ux * push, -RING, RING);
        a.z = clamp(a.z - uz * push, -RING, RING);
      }
    }
  }

  // ── o computador ──────────────────────────────────────────────────────────

  ai(A, D, T) {
    const R = this.R;
    const dist = Math.hypot(D.x - A.x, D.z - A.z);
    const ux = (D.x - A.x) / (dist || 1);
    const uz = (D.z - A.z) / (dist || 1);
    // viu o outro começar um combo: esquiva (pelo reflexo), depois de reagir
    const da = D.act;
    if (da.code === ACT.COMBO && da.seq !== A.aiSeen && this.t < da.end) {
      A.aiSeen = da.seq;
      if (R() < clamp(0.42 * A.f.reflex * A.ai * A.f.sg.guard, 0, 0.6)) A.aiDodgeAt = this.t + (0.08 + 0.22 * R()) / (0.6 + 0.6 * A.f.reflex);
    }
    if (A.aiDodgeAt !== null && this.t >= A.aiDodgeAt) {
      A.aiDodgeAt = null;
      if (this.dodge(A)) return;
    }
    A.aiCool -= T;
    if (A.aiCool > 0 || !this.canAct(A)) return;
    const sf = this.stamF(A);
    const hurt = A.blood < 30;
    const oppHurt = D.blood < 35 || D.stun > 0;
    if (dist > BOXE.RANGE + 0.12) {
      const circle = hurt && !oppHurt ? 0.8 : 0.25;
      A.aiDir = { x: ux - uz * A.aiSide * circle, z: uz + ux * A.aiSide * circle };
      const n = Math.hypot(A.aiDir.x, A.aiDir.z) || 1;
      A.aiDir.x /= n;
      A.aiDir.z /= n;
      A.aiCool = 0.25 + R() * 0.2;
      return;
    }
    let p = (0.3 + 0.4 * A.f.aggression) * A.f.sg.attack * A.ai * (0.3 + 0.7 * sf) * (oppHurt ? 1.5 : 1) * (hurt ? 0.6 : 1);
    if (A.stam < 12) p *= 0.15;
    if (R() < p) {
      const n = sf > 0.6 && R() < 0.55 ? 1 + Math.floor(R() * MAX_PIECES) : 1 + (R() < 0.35 ? 1 : 0);
      A.aiDir = { x: 0, z: 0 };
      this.attack(A, randomCombo(R, Math.min(MAX_PIECES, n)));
      A.aiCool = 0.15 + R() * 0.35 / A.ai;
      return;
    }
    const r = R();
    if (hurt && r < 0.5) A.aiDir = { x: -ux, z: -uz };
    else if (r < 0.55) A.aiDir = { x: -uz * A.aiSide, z: ux * A.aiSide };
    else if (dist < BOXE.RANGE - 0.15) A.aiDir = { x: -ux * 0.6, z: -uz * 0.6 };
    else A.aiDir = { x: 0, z: 0 };
    if (R() < 0.25) A.aiSide = -A.aiSide;
    A.aiCool = (0.25 + R() * 0.4) / (0.6 + 0.5 * A.f.hands);
  }

  // ── sinos, quedas, fim ────────────────────────────────────────────────────

  bell(round) {
    this.round = round;
    this.phase = PH.ROUND;
    this.clock = BOXE.ROUND_S;
    this.roundPts = [0, 0];
    this.kdRound = this.F.map((p) => p.kd);
    for (const A of this.F) {
      A.act = { ...A.act, code: ACT.NONE, hits: [] };
      A.stun = 0;
      A.aiCool = 0.4 + this.R() * 0.5;
    }
    this.ev.push([r2(this.t), EV.BELL, round]);
  }

  endRound() {
    const [pa, pb] = this.roundPts;
    let ca = 10;
    let cb = 10;
    if (Math.abs(pa - pb) > 3) pa > pb ? (cb = 9) : (ca = 9);
    ca -= this.F[0].kd - this.kdRound[0];
    cb -= this.F[1].kd - this.kdRound[1];
    this.cards.push([Math.max(7, ca), Math.max(7, cb)]);
    this.ev.push([r2(this.t), EV.BREAK, this.round]);
    if (this.round >= BOXE.ROUNDS) {
      const sa = this.cards.reduce((n, c) => n + c[0], 0);
      const sb = this.cards.reduce((n, c) => n + c[1], 0);
      this.finish(sa > sb ? 0 : sb > sa ? 1 : -1, sa === sb ? "draw" : "points");
      return;
    }
    this.phase = PH.BREAK;
    this.breakLeft = BOXE.BREAK_S;
    for (const A of this.F) {
      A.blood = Math.min(A.bloodMax, A.blood + 8 + 10 * A.f.chin);
      A.stam = Math.min(A.stamMax, A.stam + 30 * A.f.engine + 10);
      A.act = { ...A.act, code: ACT.NONE, hits: [] };
      A.stun = 0;
      A.kx = A.kz = 0;
    }
  }

  knockdown(D, A) {
    D.kd++;
    A.tally.kd++;
    D.down = true;
    this.setAct(D, ACT.DOWN);
    if (A.act.code !== ACT.NONE) A.act = { ...A.act, code: ACT.NONE, hits: [] };
    this.roundPts[A.i] += 12;
    this.ev.push([r2(this.t), EV.DOWN, D.i, D.kd]);
    if (D.kd >= BOXE.MAX_KD) {
      this.ev.push([r2(this.t + BOXE.FALL_S), EV.KO, D.i, 1]);
      this.finish(A.i, "tko", BOXE.FALL_S);
      return;
    }
    D.taps = 0;
    const need = 0.42 + 0.2 * (D.kd - 1) + 0.55 * this.R() + (D.tally.taken > 160 ? 0.15 : 0) - 0.25 * (D.f.chin - 0.7);
    this.count = { who: D.i, n: 0, next: r3(this.t + BOXE.FALL_S), will: 0, need, riseAt: null };
    this.phase = PH.COUNT;
  }

  counting() {
    const c = this.count;
    const D = this.F[c.who];
    if (c.riseAt !== null) {
      if (this.t >= c.riseAt) {
        // de pé: o árbitro limpa as luvas e volta o round
        D.down = false;
        D.blood = Math.min(D.bloodMax, 18 + 26 * D.f.chin * (0.8 + this.R() * 0.4) - 4 * (D.kd - 1));
        D.stam = Math.min(D.stamMax, D.stam + 15);
        D.stun = BOXE.RESUME_S + 0.3;
        D.act = { ...D.act, code: ACT.NONE, hits: [] };
        this.ev.push([r2(this.t), EV.UP, D.i]);
        this.count = null;
        this.phase = PH.ROUND;
      }
      return;
    }
    if (this.t < c.next) return;
    c.n++;
    c.next = r3(c.next + BOXE.COUNT_S);
    this.ev.push([r2(this.t), EV.COUNT, D.i, c.n]);
    // a vontade de levantar: o queixo, e os toques de quem está no chão
    c.will += 0.07 + 0.09 * D.f.chin + 0.035 * D.taps + (D.cpu ? 0.02 * D.ai : 0);
    D.taps = 0;
    if (c.n >= 10) {
      this.ev.push([r2(this.t + 0.4), EV.KO, D.i, 0]);
      this.finish(1 - D.i, "ko", 0.4);
      return;
    }
    if (c.n >= 3 && c.will >= c.need) {
      c.riseAt = r3(this.t + BOXE.RISE_S);
      this.setAct(D, ACT.RISE, { end: c.riseAt });
    }
  }

  finish(winner, method, after = 0) {
    this.phase = PH.END;
    this.count = null;
    this.result = { winner, method, round: this.round, t: r2(this.t + after) };
    this.ev.push([r2(this.t + after), EV.END, winner]);
    for (const A of this.F) {
      if (A.act.code === ACT.DOWN) continue;
      if (winner === A.i) this.setAct(A, ACT.WIN, { t0: r3(this.t + after + 0.8) });
      else this.setAct(A, ACT.LOSE, { t0: r3(this.t + after + 0.8) });
    }
  }

  /** Toalha: quem jogou perde agora. */
  towel(who) {
    if (this.result) return false;
    for (const A of this.F) A.down = false;
    this.finish(1 - who, "towel");
    this.result.towel = who;
    return true;
  }

  // ── o que vai para os aparelhos ───────────────────────────────────────────

  snapshot() {
    const ev = this.ev;
    this.ev = [];
    const ph = this.phase === PH.ROUND ? [PH.ROUND, this.round, r2(Math.max(0, this.clock))] : this.phase === PH.BREAK ? [PH.BREAK, this.round, r2(Math.max(0, this.breakLeft))] : this.phase === PH.COUNT ? [PH.COUNT, this.round, r2(Math.max(0, this.clock))] : [this.phase, this.round, 0];
    return {
      t: r3(this.t),
      ph,
      cnt: this.count ? [this.count.who, this.count.n] : null,
      f: this.F.map((A) => [
        r3(A.x),
        r3(A.z),
        r1(A.blood),
        r1(A.stam),
        r1(A.bloodMax),
        A.act.code,
        A.act.seq,
        A.act.t0,
        A.act.rate,
        A.act.cid,
        A.act.pieces,
        this.footSpeed(A),
        this.atkRate(A),
        A.tally.thrown,
        A.tally.landed,
        A.tally.kd,
      ]),
      ev,
    };
  }

  /** O que valeu para `who` (vai para a vida). */
  summary(who) {
    const A = this.F[who];
    const res = this.result || { winner: -1, method: "draw", round: this.round, t: this.t };
    let outcome;
    if (res.method === "towel") outcome = res.towel === who ? "loss" : "win";
    else outcome = res.winner === -1 ? "draw" : res.winner === who ? "win" : "loss";
    return {
      outcome,
      method: res.method,
      taken: r1(A.tally.taken),
      thrown: A.tally.thrown,
      landed: A.tally.landed,
      kd: A.kd,
      activeS: Math.round(this.activeS),
      at: r2(res.t),
      round: res.round,
    };
  }

  /** Placar dos juízes (soma dos rounds fechados). */
  score() {
    return [0, 1].map((i) => this.cards.reduce((n, c) => n + c[i], 0));
  }

  /** Para o aparelho: a tabela dos pedaços e das reações (fonte única daqui). */
  static table() {
    return {
      fps: FPS,
      pieces: PIECES.map((p) => ({ clip: p.clip, from: (p.from - 1) / (p.n - 1), to: (p.to - 1) / (p.n - 1), dur: r3(pieceDur(PIECES.indexOf(p))), hits: p.hits.map((h) => [r3((h[0] - p.from) / FPS), h[1]]) })),
      weights: PIECE_W,
      maxPieces: MAX_PIECES,
      dodge: { clip: DODGE.clip, from: (DODGE.from - 1) / (DODGE.n - 1), to: (DODGE.to - 1) / (DODGE.n - 1), dur: r3((DODGE.to - DODGE.from) / FPS) },
      react: Object.fromEntries(Object.entries(REACT).map(([k, r]) => [k, { clip: r.clip, from: (r.from - 1) / (r.n - 1), to: (r.to - 1) / (r.n - 1), dur: r.dur }])),
      ring: BOXE.RING,
      minSep: BOXE.MIN_SEP,
      reach: BOXE.REACH,
      corners: CORNERS,
      roundS: BOXE.ROUND_S,
      breakS: BOXE.BREAK_S,
      rounds: BOXE.ROUNDS,
      riseS: BOXE.RISE_S,
    };
  }
}

module.exports = { BOXE, PIECES, PIECE_W, DODGE, REACT, ACT, STRATEGIES, TIERS, EV, RES, PH, CORNERS, fighter, cpuStats, randomCombo, validCombo, Match, rng };
