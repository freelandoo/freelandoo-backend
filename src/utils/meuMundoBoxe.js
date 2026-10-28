// src/utils/meuMundoBoxe.js — MEU MUNDO 3D: a luta da Arena de Boxe (mm3d-43).
//
// Pedido do Alex: "lá você não controla o personagem; o que conta é
// velocidade, força, o treino, se está alimentado, descansado — você calcula
// tudo e deixa eles brigando, com barra de sangue e de cansaço, e o usuário
// assiste". Então a luta é uma SIMULAÇÃO com semente, calculada inteira no
// servidor na largada (ela mexe na vida: saúde, energia, hospital). Os
// aparelhos recebem a LINHA DO TEMPO (golpes, defesas, quedas e amostras de
// sangue/fôlego/posição) e só desenham — nada de conta de ponto flutuante
// repetida em dois motores.
//
// Regras (jogo, não manual de boxe):
//  • 3 rounds de ROUND_S com BREAK_S de intervalo; no intervalo o canto
//    devolve um pouco de sangue e de fôlego.
//  • Sangue 0 = QUEDA. Contagem até 10 (o relógio do round para): levanta
//    conforme queixo e saúde, com menos sangue a cada queda; não levantou =
//    nocaute; a 3ª queda = nocaute técnico.
//  • Sem queda decisiva = pontos (round a round, 10 × 9; queda tira 1).
//  • Fôlego (cansaço): cada golpe gasta, errar gasta mais, levar no corpo
//    tira; volta devagar com a guarda. Cansado = mão lenta, guarda baixa,
//    mais golpe limpo levado. O teto do fôlego desce ao longo da luta.
//
// O lutador sai da VIDA (fightStats em meuMundoLife.js → fighter() aqui):
// força e velocidade (o treino, 0–1000), massa magra, gordura, saúde,
// vitalidade, energia (descansado), saciedade (alimentado), estresse, horas
// acordado, resistência de longo prazo e a personalidade (agressividade).
// O computador é gerado pelos números do jogador (mais fraco/parelho/mais forte).

const BOXE = Object.freeze({
  ROUNDS: 3,
  ROUND_S: 60,
  BREAK_S: 10,
  TICK: 0.05,
  /** Amostras de posição/sangue/fôlego para os aparelhos (s). */
  SAMPLE: 0.2,
  /** Meia largura útil do ringue (m): as cordas ficam em ±3,1. */
  RING: 2.7,
  /** Distância de luta (centro a centro, m). */
  RANGE: 1.05,
  /** Uma contagem do árbitro (s): 10 contagens ≈ 7 s. */
  COUNT_S: 0.7,
  /** Tempo da queda até a contagem começar (s). */
  FALL_S: 1.3,
  /** Depois de levantar, o árbitro limpa as luvas (s). */
  RESUME_S: 1.6,
  /** Fim (nocaute ou sino final) até a sala fechar a luta (s). */
  OUTRO_S: 6,
  MAX_KD: 3,
  /** Golpe acima disto (de sangue) atordoa. */
  STUN_DMG: 7,
  /** Escala geral do dano (calibrada: luta parelha de nível médio ≈ metade por nocaute). */
  DMG: 0.66,
});

/** Golpes: tempo total, momento(s) do impacto, dano, fôlego, alcance, precisão. */
const PUNCHES = Object.freeze({
  jab: { dur: 0.5, hits: [0.2], dmg: [4], stam: 1.6, reach: 1.3, acc: 1 },
  cross: { dur: 0.62, hits: [0.27], dmg: [7], stam: 2.6, reach: 1.25, acc: 0.9 },
  hook: { dur: 0.72, hits: [0.34], dmg: [9], stam: 3.4, reach: 1.05, acc: 0.82 },
  upper: { dur: 0.78, hits: [0.36], dmg: [10.5], stam: 3.9, reach: 0.95, acc: 0.76 },
  combo: { dur: 1.55, hits: [0.22, 0.6, 1.0], dmg: [4, 6, 8], stam: 6.8, reach: 1.2, acc: 0.86 },
});
const PUNCH_KINDS = Object.keys(PUNCHES);

/** Estratégia escolhida antes da luta. */
const STRATEGIES = Object.freeze({
  aggressive: { attack: 1.35, guard: 0.75, power: 1.25 },
  balanced: { attack: 1, guard: 1, power: 1 },
  defensive: { attack: 0.7, guard: 1.35, power: 0.85 },
});

/** Adversários do computador: escala dos números do jogador. */
const TIERS = Object.freeze({
  easy: { mul: 0.78, purse: 15 },
  even: { mul: 1, purse: 40 },
  hard: { mul: 1.2, purse: 90 },
});

/** Códigos da linha do tempo (o aparelho tem a mesma lista). */
const EV = Object.freeze({
  BELL: 0, // início de round (who = round 1..3)
  BREAK: 1, // fim de round (who = round)
  PUNCH: 2, // [t, who, 2, kind, res, dmg, zone]: kind índice de PUNCH_KINDS; res 0 erro 1 bloqueio 2 esquiva 3 acerto 4 limpo
  DOWN: 3, // [t, who, 3, kd]
  COUNT: 4, // [t, who, 4, n]
  UP: 5, // [t, who, 5]
  KO: 6, // [t, who(caído), 6, tko?1:0]
  STUN: 7, // [t, who, 7]
  END: 8, // [t, winner(-1 empate), 8]
});
const RES = Object.freeze({ MISS: 0, BLOCK: 1, SLIP: 2, HIT: 3, CLEAN: 4 });

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
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

// ═══ A LUTA ═══

/**
 * Luta inteira, de uma vez. `a` e `b` = { stats, strategy }. Devolve a
 * linha do tempo para os aparelhos e o resultado (ver summary()).
 */
function simulate(a, b, seed) {
  const R = rng(seed);
  const T = BOXE.TICK;
  const F = [a, b].map((x, i) => {
    const f = fighter(x.stats, x.strategy);
    return {
      i,
      f,
      x: i === 0 ? -1.6 : 1.6,
      z: i === 0 ? -0.4 : 0.4,
      blood: 100,
      bloodMax: 100,
      stam: 100,
      stamMax: 100,
      act: null, // { kind, t0, dur, hits, next }
      cool: 0.6 + R() * 0.5,
      move: "in",
      side: R() < 0.5 ? -1 : 1,
      moveFor: 0,
      guard: 1,
      stun: 0,
      down: false,
      kd: 0,
      thrown: 0,
      landed: 0,
      dmgDealt: 0,
      dmgTaken: 0,
      roundPts: 0,
    };
  });
  const ev = [];
  const smp = [[], []];
  const cards = [];
  let t = 0;
  let nextSample = 0;
  let result = null;

  const sample = () => {
    for (const p of F) smp[p.i].push(r2(p.x), r2(p.z), Math.round(p.blood), Math.round(p.stam));
  };
  const sampleTo = (until) => {
    while (nextSample <= until + 1e-9) {
      sample();
      nextSample = r2(nextSample + BOXE.SAMPLE);
    }
  };
  const stamF = (p) => clamp(p.stam / 100);

  /** Golpe chega: decide erro, bloqueio, esquiva, acerto ou limpo. */
  const land = (A, D, kind, k) => {
    const P = PUNCHES[kind];
    const dist = Math.hypot(A.x - D.x, A.z - D.z);
    const out = [r2(t), A.i, EV.PUNCH, PUNCH_KINDS.indexOf(kind), RES.MISS, 0, 0];
    if (D.down || dist > P.reach + 0.25) {
      A.stam = Math.max(0, A.stam - P.stam * 0.4);
      ev.push(out);
      return;
    }
    const busy = !!D.act;
    const cornered = Math.max(Math.abs(D.x), Math.abs(D.z)) > BOXE.RING - 0.25 ? 0.85 : 1;
    const defense = D.f.reflex * (0.22 + 0.36 * D.guard) * (0.45 + 0.55 * stamF(D)) * (busy ? 0.45 : 1) * (D.stun > 0 ? 0.35 : 1) * cornered * D.f.sg.guard;
    const hitP = clamp(A.f.accuracy * P.acc * (0.55 + 0.45 * stamF(A)) * (0.85 + 0.3 * A.f.hands) - defense * 0.75, 0.12, 0.9);
    if (R() > hitP) {
      // não entrou: guarda alta segura; senão escapou (ou passou longe)
      const blocked = D.guard > 0.55 && !busy && R() < 0.75;
      if (blocked) {
        out[4] = RES.BLOCK;
        const chip = BOXE.DMG * P.dmg[k] * A.f.power * 0.12;
        D.blood = Math.max(0.5, D.blood - chip);
        D.stam = Math.max(0, D.stam - P.dmg[k] * 0.25);
        out[5] = r1(chip);
      } else {
        out[4] = R() < 0.6 ? RES.SLIP : RES.MISS;
        A.stam = Math.max(0, A.stam - P.stam * 0.35);
      }
      ev.push(out);
      return;
    }
    const cleanP = 0.07 + 0.22 * (1 - stamF(D)) + (D.stun > 0 ? 0.2 : 0) + (kind === "upper" || kind === "hook" ? 0.04 : 0);
    const clean = R() < cleanP;
    const body = kind !== "jab" && R() < 0.3;
    let dmg = (BOXE.DMG * P.dmg[k] * A.f.power * A.f.sg.power * (0.55 + 0.45 * stamF(A)) * (clean ? 1.6 : 1) * (0.82 + R() * 0.36)) / D.f.chin;
    if (body) dmg *= 0.6;
    dmg = Math.max(0.5, dmg);
    D.blood = Math.max(0, D.blood - dmg);
    D.stam = Math.max(0, D.stam - dmg * (body ? 1.1 : 0.35));
    D.bloodMax = Math.max(40, D.bloodMax - dmg * 0.18);
    A.landed++;
    A.dmgDealt += dmg;
    D.dmgTaken += dmg;
    A.roundPts += dmg * (clean ? 1.3 : 1);
    out[4] = clean ? RES.CLEAN : RES.HIT;
    out[5] = r1(dmg);
    out[6] = body ? 1 : 0;
    ev.push(out);
    // empurrão do golpe
    const ux = (D.x - A.x) / (dist || 1);
    const uz = (D.z - A.z) / (dist || 1);
    const push = Math.min(0.35, dmg * 0.025);
    D.x = clamp(D.x + ux * push, -BOXE.RING, BOXE.RING);
    D.z = clamp(D.z + uz * push, -BOXE.RING, BOXE.RING);
    if (D.act && dmg > 5) D.act = null; // interrompido
    if (dmg >= BOXE.STUN_DMG || (clean && dmg > 6)) {
      D.stun = 0.5 + Math.min(0.9, dmg * 0.04);
      ev.push([r2(t), D.i, EV.STUN]);
    }
  };

  /** Escolhe o que fazer agora (sem golpe em andamento). */
  const decide = (A, D) => {
    const dist = Math.hypot(A.x - D.x, A.z - D.z);
    const sf = stamF(A);
    const hurt = A.blood < 30;
    const oppHurt = D.blood < 35 || D.stun > 0;
    const sg = A.f.sg;
    // guarda: sobe com a estratégia e desce com o cansaço
    A.guard = clamp((0.55 + 0.35 * sg.guard - 0.25) * (0.5 + 0.5 * sf) + (hurt ? 0.2 : 0));
    if (dist > PUNCHES.jab.reach + 0.1) {
      A.move = hurt && !oppHurt && R() < 0.5 ? "circle" : "in";
      A.moveFor = 0.4 + R() * 0.5;
      A.cool = 0.1;
      return;
    }
    let attack = (0.32 + 0.4 * A.f.aggression) * sg.attack * (0.35 + 0.65 * sf) * (oppHurt ? 1.5 : 1) * (hurt ? 0.6 : 1);
    if (A.stam < 8) attack *= 0.15;
    if (R() < attack) {
      // escolhe o golpe
      const w = {
        jab: 3.2,
        cross: 2.2,
        hook: dist < 1.15 ? 1.7 : 0.6,
        upper: dist < 1.0 ? 1.4 : 0.2,
        combo: sf > 0.45 ? 1.1 * (oppHurt ? 1.8 : 1) : 0.2,
      };
      if (oppHurt) {
        w.hook *= 1.6;
        w.upper *= 1.6;
      }
      if (sf < 0.3) {
        w.jab *= 1.5;
        w.combo *= 0.2;
      }
      let sum = 0;
      for (const k of PUNCH_KINDS) sum += w[k];
      let r = R() * sum;
      let kind = "jab";
      for (const k of PUNCH_KINDS) {
        r -= w[k];
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      const P = PUNCHES[kind];
      // mão lenta (cansado/destreinado) = o golpe demora mais
      const slow = 1 / (0.75 + 0.35 * A.f.hands) / (0.8 + 0.2 * sf);
      A.act = { kind, t0: t, dur: P.dur * slow, hits: P.hits.map((h) => h * slow), next: 0 };
      A.stam = Math.max(0, A.stam - P.stam * (1.1 - 0.3 * A.f.engine));
      A.stamMax = Math.max(55, A.stamMax - P.stam * 0.07);
      A.thrown++;
      A.cool = 0.12 + R() * 0.35;
      return;
    }
    // sem golpe: anda (recua machucado, cerca, gira)
    const r = R();
    if (hurt && r < 0.55) A.move = "out";
    else if (r < 0.45) A.move = "circle";
    else if (dist > BOXE.RANGE + 0.1) A.move = "in";
    else A.move = "hold";
    if (R() < 0.3) A.side = -A.side;
    A.moveFor = 0.35 + R() * 0.6;
    A.cool = (0.25 + R() * 0.45) / (0.6 + 0.5 * A.f.hands);
  };

  const step = (A, D) => {
    if (A.stun > 0) A.stun = Math.max(0, A.stun - T);
    // golpe em andamento
    if (A.act) {
      const a = A.act;
      while (a.next < a.hits.length && t - a.t0 >= a.hits[a.next]) land(A, D, a.kind, a.next++);
      if (t - a.t0 >= a.dur) A.act = null;
    } else {
      A.cool -= T;
      if (A.cool <= 0 && A.stun <= 0) decide(A, D);
    }
    // pernas
    const dx = D.x - A.x;
    const dz = D.z - A.z;
    const dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist;
    const uz = dz / dist;
    const foot = (0.7 + 0.8 * A.f.hands) * (0.55 + 0.45 * stamF(A)) * (A.stun > 0 ? 0.3 : 1) * (A.act ? 0.25 : 1);
    let vx = 0;
    let vz = 0;
    A.moveFor -= T;
    const mv = A.moveFor > 0 ? A.move : dist > BOXE.RANGE + 0.15 ? "in" : "hold";
    if (mv === "in" && dist > BOXE.RANGE - 0.05) (vx = ux), (vz = uz);
    else if (mv === "out") (vx = -ux), (vz = -uz);
    else if (mv === "circle") (vx = -uz * A.side + ux * (dist - BOXE.RANGE)), (vz = ux * A.side + uz * (dist - BOXE.RANGE));
    if (dist < 0.8) (vx -= ux), (vz -= uz);
    const n = Math.hypot(vx, vz);
    if (n > 0) {
      A.x += (vx / n) * foot * T;
      A.z += (vz / n) * foot * T;
    }
    // nas cordas: escorrega para o lado (gira pelo ringue)
    if (Math.abs(A.x) > BOXE.RING) A.x = Math.sign(A.x) * BOXE.RING;
    if (Math.abs(A.z) > BOXE.RING) A.z = Math.sign(A.z) * BOXE.RING;
    // fôlego volta com a guarda; teto desce ao longo da luta
    const regen = A.f.engine * (A.act ? 0.6 : A.move === "hold" ? 4.2 : 3) * (0.7 + 0.3 * clamp(A.blood / 60));
    A.stam = Math.min(A.stamMax, A.stam + regen * T);
  };

  /** Contagem de uma queda (o relógio do round fica parado). */
  const knockdown = (D, A) => {
    D.kd++;
    D.down = true;
    D.act = null;
    A.act = null;
    A.roundPts += 12;
    ev.push([r2(t), D.i, EV.DOWN, D.kd]);
    sampleTo(t);
    if (D.kd >= BOXE.MAX_KD) {
      t = r2(t + BOXE.FALL_S);
      ev.push([r2(t), D.i, EV.KO, 1]);
      return true;
    }
    const riseP = clamp(0.42 + 0.55 * D.f.chin - 0.22 * (D.kd - 1) - (D.dmgTaken > 160 ? 0.15 : 0), 0.05, 0.95);
    const rises = R() < riseP;
    const at = rises ? 3 + Math.floor(R() * 6) : 10;
    let c0 = t + BOXE.FALL_S;
    for (let n = 1; n <= at; n++) {
      const tc = r2(c0 + (n - 1) * BOXE.COUNT_S);
      // posições paradas enquanto conta
      sampleTo(tc);
      ev.push([tc, D.i, EV.COUNT, n]);
    }
    t = r2(c0 + (at - 1) * BOXE.COUNT_S + 0.4);
    if (!rises) {
      ev.push([r2(t), D.i, EV.KO, 0]);
      return true;
    }
    ev.push([r2(t), D.i, EV.UP]);
    D.down = false;
    D.blood = Math.min(D.bloodMax, 18 + 26 * D.f.chin * (0.8 + R() * 0.4) - 4 * (D.kd - 1));
    D.stam = Math.min(D.stamMax, D.stam + 15);
    D.stun = 0.8;
    // o árbitro separa
    const dx = D.x - A.x;
    const dz = D.z - A.z;
    const dd = Math.hypot(dx, dz) || 1;
    A.x = clamp(D.x - (dx / dd) * 1.9, -BOXE.RING, BOXE.RING);
    A.z = clamp(D.z - (dz / dd) * 1.9, -BOXE.RING, BOXE.RING);
    t = r2(t + BOXE.RESUME_S);
    sampleTo(t);
    return false;
  };

  sample();
  nextSample = BOXE.SAMPLE;
  for (let round = 1; round <= BOXE.ROUNDS && !result; round++) {
    if (round > 1) {
      // intervalo: cada um no seu canto, o canto cuida
      for (const p of F) {
        p.x = p.i === 0 ? -1.6 : 1.6;
        p.z = p.i === 0 ? -0.4 : 0.4;
        p.blood = Math.min(p.bloodMax, p.blood + 8 + 10 * p.f.chin);
        p.stam = Math.min(p.stamMax, p.stam + 30 * p.f.engine + 10);
        p.act = null;
        p.stun = 0;
        p.cool = 0.5 + R() * 0.4;
      }
      t = r2(t + BOXE.BREAK_S);
      sampleTo(t);
    }
    ev.push([r2(t), round, EV.BELL]);
    for (const p of F) p.roundPts = 0;
    const kd0 = F.map((p) => p.kd);
    let clock = 0;
    while (clock < BOXE.ROUND_S - 1e-9 && !result) {
      t = r2(t + T);
      clock += T;
      const order = R() < 0.5 ? [0, 1] : [1, 0];
      for (const i of order) step(F[i], F[1 - i]);
      sampleTo(t);
      for (const D of F) {
        if (D.blood <= 0 && !D.down) {
          const A = F[1 - D.i];
          if (knockdown(D, A)) {
            result = { winner: A.i, method: D.kd >= BOXE.MAX_KD ? "tko" : "ko", round, t: r2(t) };
            break;
          }
        }
      }
    }
    // cartão do round: 10 × 9 para quem fez mais; cada queda tira 1
    const [pa, pb] = F.map((p) => p.roundPts);
    let ca = 10;
    let cb = 10;
    if (Math.abs(pa - pb) > 1.5) pa > pb ? (cb = 9) : (ca = 9);
    ca -= F[0].kd - kd0[0];
    cb -= F[1].kd - kd0[1];
    cards.push([Math.max(7, ca), Math.max(7, cb)]);
    if (!result) ev.push([r2(t), round, EV.BREAK]);
  }
  if (!result) {
    const sa = cards.reduce((n, c) => n + c[0], 0);
    const sb = cards.reduce((n, c) => n + c[1], 0);
    result = { winner: sa > sb ? 0 : sb > sa ? 1 : -1, method: sa === sb ? "draw" : "points", round: BOXE.ROUNDS, t: r2(t) };
  }
  ev.push([r2(t), result.winner, EV.END]);
  sampleTo(t);
  const totals = [cards.reduce((n, c) => n + c[0], 0), cards.reduce((n, c) => n + c[1], 0)];
  return {
    v: 1,
    seed,
    sample: BOXE.SAMPLE,
    rounds: BOXE.ROUNDS,
    roundS: BOXE.ROUND_S,
    breakS: BOXE.BREAK_S,
    dur: r2(t + BOXE.OUTRO_S),
    ev,
    smp,
    cards,
    result: { ...result, score: totals },
    stats: F.map((p) => ({ thrown: p.thrown, landed: p.landed, kd: p.kd, dmg: r1(p.dmgDealt), taken: r1(p.dmgTaken) })),
    view: F.map((p) => ({ ...p.f.view, conditions: p.f.conditions, strategy: p.f.strategy })),
  };
}

/**
 * O que valeu até `at` (s) para o lutador `who`: com a toalha (`towel` =
 * quem jogou) a luta acaba ali e quem jogou perde. Dano, golpes e quedas
 * contados pela linha do tempo até o corte.
 */
function summary(fight, who, at = Infinity, towel = null) {
  const cut = Math.min(at, fight.result.t);
  let taken = 0;
  let thrown = 0;
  let landed = 0;
  let kd = 0;
  let activeS = 0;
  for (const e of fight.ev) {
    if (e[0] > cut + 1e-9) break;
    if (e[2] === EV.PUNCH) {
      if (e[1] === who) {
        thrown++;
        if (e[4] >= RES.HIT) landed++;
      } else if (e[4] >= RES.BLOCK) taken += e[5];
    } else if (e[2] === EV.DOWN && e[1] === who) kd = e[3];
  }
  // segundos de luta de verdade (sem intervalos)
  for (const e of fight.ev) {
    if (e[2] !== EV.BELL) continue;
    const start = e[0];
    if (start > cut) break;
    const end = fight.ev.find((x) => (x[2] === EV.BREAK && x[1] === e[1]) || x[2] === EV.END)?.[0] ?? cut;
    activeS += Math.max(0, Math.min(end, cut) - start);
  }
  let outcome;
  let method = fight.result.method;
  if (towel != null && cut < fight.result.t) {
    outcome = towel === who ? "loss" : "win";
    method = "towel";
  } else outcome = fight.result.winner === -1 ? "draw" : fight.result.winner === who ? "win" : "loss";
  return { outcome, method, taken: r1(taken), thrown, landed, kd, activeS: Math.round(activeS), at: r2(cut), round: roundAt(fight, cut) };
}

function roundAt(fight, at) {
  let r = 1;
  for (const e of fight.ev) {
    if (e[0] > at) break;
    if (e[2] === EV.BELL) r = e[1];
  }
  return r;
}

module.exports = { BOXE, PUNCHES, PUNCH_KINDS, STRATEGIES, TIERS, EV, RES, fighter, cpuStats, simulate, summary, rng };
