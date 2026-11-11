// src/utils/meuMundoAdventure.js — MEU MUNDO 3D mm3d-59: progressão de aventura.
//
// Regra pura (sem banco): XP/nível de aventura, o que cada atividade treina,
// quanto um tempo ATIVO VALIDADO pelo servidor rende e quanto uma luta custa.
// Quem chama (MeuMundoAdventureService) aplica dentro de `withLife` e grava o
// RECIBO na mesma transação. Plano: MEU MUNDO 3D/planos/2026-11-02-mm3d-59-reforma.md.
//
// Separação (pedido do Alex): pontuação do minijogo ≠ XP de aventura ≠
// atributos ≠ moedas ≠ itens. Atributo é PRÁTICA (vale na derrota com
// participação válida); vitória melhora XP e loot.
"use strict";

const Life = require("./meuMundoLife");
const FightSim = require("./meuMundoFight");

// R4 (trilha E4): equipamento proporcional (multiplica a ficha) e chaves hp/acc/spd/int/dex.
// R5 (trilha E5): freio do drop de atributo pela régua e monstro da rua por fator da régua.
const RULES_VERSION = "R5";

// ═══ XP DE AVENTURA ═══ — por pessoa (atravessa gerações).
// Para ir do nível n ao n+1: round(BASE × n^EXP). 1→2 = 100, 2→3 = 303,
// 5→6 = 1314, 10→11 = 3981. O prólogo soma ≥ 420 → garante o nível 3.
const XP = Object.freeze({ BASE: 100, EXP: 1.6 });

const xpToNext = (n) => Math.round(XP.BASE * Math.pow(n, XP.EXP));

/** Nível pelo XP total: { level, into, need, total }. */
function levelOf(total) {
  let xp = Math.max(0, Math.floor(Number(total) || 0));
  let level = 1;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
  }
  return { level, into: xp, need: xpToNext(level), total: Math.max(0, Math.floor(Number(total) || 0)) };
}

/** O que cada nível destrava (só informação; quem confere é cada serviço). */
const UNLOCKS = Object.freeze({
  2: ["armeiro"],
  3: ["forja"],
  4: ["acessorio_2"],
  5: ["receitas_raras"],
});

// ═══ ATIVIDADES ═══ — atributo principal e secundário (tabela do Alex).
// São sete minijogos (Corrida e Antigravidade são o mesmo jogo) + academia e
// universidade (essas rendem pela VIDA, por hora útil — meuMundoLife.js).
const ACTIVITIES = Object.freeze({
  laminas: { main: "strength", sec: "dexterity", maxMin: 4, loot: "forja" },
  boxe: { main: "strength", sec: "dexterity", maxMin: 4, loot: "couro" },
  paint: { main: "dexterity", sec: "intelligence", maxMin: 12, loot: "pigmento" },
  gincana: { main: "dexterity", sec: "speed", maxMin: 6, loot: "mola" },
  jetpack: { main: "dexterity", sec: "intelligence", maxMin: 8, loot: "vapor" },
  corrida: { main: "dexterity", sec: "intelligence", maxMin: 8, loot: "capacitor" },
  noturno: { main: "dexterity", sec: "speed", maxMin: 10, loot: "rolamento" },
});

/** Por 10 minutos ATIVOS válidos (proporcional). */
const PER_10MIN = Object.freeze({ main: 1, sec: 0.3 });

/** XP por 10 min ativos de minijogo; luta: por monstro e nível. */
const XP_GAIN = Object.freeze({
  minigamePer10: 6,
  fightWin: { cavaleiro: 30, stone: 30, wolf: 45, ciborgue: 50, garras: 55, brute: 80 },
  fightLevelMul: 0.5, // +50% por nível acima do 1
  fightLoss: 10,
});

// ═══ CUSTO DA LUTA (energia/estresse persistentes) ═══
// mm3d-60b (Alex): vitória cansa pouco e ALIVIA o estresse; derrota cansa
// mais e estressa mais.
const FIGHT_COST = Object.freeze({
  win: { energy: -4, stress: -3 },
  loss: { energy: -10, stress: 6 },
  /** A partir da 3ª derrota seguida no dia: sem estresse (não empilha punição). */
  calmAfter: 3,
});

const MIN_MS = 60000;

// ═══ RESULTADO E DISPOSIÇÃO (mm3d-60b, pedido do Alex) ═══
// "Quando perde ganha pouco, quando é vitória ganha mais status; com bastante
// energia e pouco estresse o drop de status é maior; quanto mais energia
// perde e o estresse aumenta, vai dropando menos."
// O ganho de atributo da prática é multiplicado por RESULTADO × DISPOSIÇÃO
// (antes do orçamento do dia, que continua sendo o teto).
const OUTCOME = Object.freeze({ win: 1.5, loss: 0.35 });
/** Disposição = 0,6 × energia + 0,4 × (100 − estresse), levada para [min, max]. */
const CONDITION = Object.freeze({ energyW: 0.6, stressW: 0.4, min: 0.3, max: 1.3 });

// ═══ DROP DE ATRIBUTO DA LUTA (mm3d-60k, regra do Alex) ═══
// "A média de drop por luta é 3 quando tem menos de 1 semana de vida, 5 com
// mais de uma semana, 9 quando bate um mês e, adulto, 15 — mas depende da
// saúde e do estresse." A média é o TOTAL de pontos de uma VITÓRIA com saúde
// cheia e sem estresse, repartido entre os 4 atributos (a luta puxa força e
// destreza). Derrota = um terço. Pontos inteiros, sorteados em volta da média.
const FIGHT_DROP = Object.freeze({
  stages: Object.freeze([
    { minDays: 0, avg: 3 },
    { minDays: 7, avg: 5 },
    { minDays: 30, avg: 9 },
  ]),
  adult: 15,
  loss: 1 / 3,
  /** Sorteio em volta da média (×0,6 … ×1,4). */
  spread: 0.4,
  /** Peso de cada atributo no drop da luta. */
  weights: Object.freeze({ strength: 0.45, dexterity: 0.3, speed: 0.15, intelligence: 0.1 }),
  /** Estresse 100 tira 60% do drop. */
  stressW: 0.6,
});

/** Média do drop pelo estágio da vida (antes da saúde/estresse). */
function fightDropAvg(ageDays, adult) {
  if (adult) return FIGHT_DROP.adult;
  let avg = FIGHT_DROP.stages[0].avg;
  for (const st of FIGHT_DROP.stages) if (ageDays >= st.minDays) avg = st.avg;
  return avg;
}

/** Saúde × estresse: saúde/vitalidade × (1 − 0,6 × estresse/100). */
function dropCondition(health, vitality, stress) {
  const h = Math.max(0, Math.min(1, Number(health) / Math.max(1, Number(vitality) || 100) || 0));
  const st = Math.max(0, Math.min(1, Number(stress) / 100 || 0));
  return Math.round(h * (1 - FIGHT_DROP.stressW * st) * 1000) / 1000;
}

/**
 * Os pontos que a luta derruba: { strength: n, ... } (inteiros, só os > 0).
 * `rand` = () => [0,1). Determinístico com o mesmo rand.
 */
function rollFightDrop({ ageDays, adult, win, health, vitality, stress }, rand) {
  const mean = fightDropAvg(ageDays, adult) * (win ? 1 : FIGHT_DROP.loss) * dropCondition(health, vitality, stress);
  const total = Math.max(0, Math.round(mean * (1 - FIGHT_DROP.spread + 2 * FIGHT_DROP.spread * rand())));
  const out = {};
  const keys = Object.keys(FIGHT_DROP.weights);
  for (let i = 0; i < total; i++) {
    let r = rand();
    let k = keys[keys.length - 1];
    for (const key of keys) {
      r -= FIGHT_DROP.weights[key];
      if (r < 0) {
        k = key;
        break;
      }
    }
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// ═══ MOEDAS (mm3d-60k, pedido do Alex) ═══ — luta e minijogo DROPAM moedas
// para comprar comida e coisas. Régua: o prato feito custa 18 e o trabalho
// rende ~14/h; uma vitória rende uma refeição barata, um minijogo inteiro
// (o tempo máximo da atividade) um pouco mais.
const COINS = Object.freeze({
  fightWin: Object.freeze({ cavaleiro: 10, stone: 10, wolf: 13, ciborgue: 14, garras: 15, brute: 20 }),
  /** +40% por nível do inimigo acima do 1. */
  fightLevelMul: 0.4,
  fightLoss: 3,
  /** Minijogo: por minuto ativo (×1,5 vencendo). */
  minigamePerMin: 2.5,
  minigameWin: 1.5,
  spread: 0.25,
});

function jitter(v, rand) {
  return Math.max(0, Math.round(v * (1 - COINS.spread + 2 * COINS.spread * rand())));
}

/** Moedas de uma luta (abandonada = 0). */
function fightCoins(kind, level, win, rand) {
  if (!win) return jitter(COINS.fightLoss, rand);
  const b = COINS.fightWin[kind] || 10;
  return jitter(b * (1 + COINS.fightLevelMul * (Math.max(1, level) - 1)), rand);
}

/** Moedas de um minijogo pelo tempo ativo elegível. */
function minigameCoins(activeMs, win, rand) {
  return jitter(COINS.minigamePerMin * (activeMs / MIN_MS) * (win ? COINS.minigameWin : 1), rand);
}

// ═══ RÉGUA DO NÍVEL (trilha E5) ═══ — o `rate` de um monstro do nível (a ficha da luta,
// mobBase): 100 no nível 1 e +18,52 por nível, sem teto. É a régua do atributo e do monstro da rua.
const ruler = (level) => FightSim.mobBase(Math.max(1, Math.round(Number(level) || 1))).rate;

// ═══ NÍVEL DO MONSTRO DA RUA ═══ — sorteado a partir do nível de quem o viu primeiro.
// Até a E4 (regra do Alex, 2026-11-06) eram níveis somados (20% igual, 30% +3/+4, 20% +6…+10,
// 20% +12, 10% +20): no nível 1 um +20 era +370% de régua e no 200 só +10%. Trilha E5 (A15, a
// recomendação do §4 seguida por ordem do Alex de tocar a trilha toda): FATOR sobre a régua com as
// mesmas chances — ×1,00 (20%), ×1,10 (30%), ×1,25 (20%), ×1,40 (20%), ×1,60 (10%); o nível é o
// menor M com régua(M) ≥ fator × régua(L). No nível 30 dá quase o sorteio de antes.
const STREET_FACTORS = Object.freeze([[0.2, 1], [0.5, 1.1], [0.7, 1.25], [0.9, 1.4], [1, 1.6]]);
function levelForFactor(L, f) {
  const want = f * ruler(L) - 1e-9;
  // régua linear: estimativa direta e ajuste fino (nunca abaixo de L)
  let M = Math.max(L, Math.floor(1 + (want - 100) / (ruler(2) - 100)) - 1);
  while (ruler(M) < want) M++;
  while (M > L && ruler(M - 1) >= want) M--;
  return M;
}
function rollMobLevel(playerLevel, rand) {
  const L = Math.max(1, Math.round(Number(playerLevel) || 1));
  const r = rand();
  const [, f] = STREET_FACTORS.find(([p]) => r < p) || STREET_FACTORS[STREET_FACTORS.length - 1];
  return levelForFactor(L, f);
}

// ═══ RITMO DO ATRIBUTO (trilha E5, A14) ═══ — o drop de cada atributo da luta é multiplicado por
// min(1, e^(−3·(atributo ÷ régua(L) − 1))): abaixo da régua, drop cheio; acima, cai rápido sem zerar.
// Sem teto: o atributo fica entre 1× e ~2,3× a régua do nível (I5).
function dropPace(attr, level) {
  return Math.min(1, Math.exp(-3 * (Math.max(0, Number(attr) || 0) / ruler(level) - 1)));
}
/** O drop com o freio aplicado, por atributo (frações de ponto valem: Life.dropAttr soma). */
function pacedDrop(drop, attrs, level) {
  const out = {};
  for (const [k, n] of Object.entries(drop || {})) {
    const v = Math.round(n * dropPace(attrs ? attrs[k] : 0, level) * 100) / 100;
    if (v > 0) out[k] = v;
  }
  return out;
}

/** Fator da disposição pela energia/estresse de ANTES da atividade: 0,3 (exausto e estressado) a 1,3 (descansado e calmo). */
function conditionFactor(energy, stress) {
  const e = Math.max(0, Math.min(1, Number(energy) / 100 || 0));
  const st = Math.max(0, Math.min(1, Number(stress) / 100 || 0));
  const vigor = CONDITION.energyW * e + CONDITION.stressW * (1 - st);
  return Math.round((CONDITION.min + (CONDITION.max - CONDITION.min) * vigor) * 100) / 100;
}

/** Multiplicador do ganho de atributo de uma luta (resultado × disposição). */
function fightGainMult(win, energy, stress) {
  return Math.round((win ? OUTCOME.win : OUTCOME.loss) * conditionFactor(energy, stress) * 1000) / 1000;
}


/**
 * Reparte o tempo ativo pelos dias de Brasília. `segments` = [{ from, to }]
 * em epoch ms, medidos pelo SERVIDOR. Devolve [{ day, at, ms }] (at = um
 * instante dentro do dia, para o orçamento daquele dia).
 */
function splitByDay(segments) {
  const out = new Map();
  for (const seg of segments || []) {
    let a = Number(seg.from);
    const b = Number(seg.to);
    if (!(b > a)) continue;
    while (a < b) {
      const { day, hour } = Life.localParts(a);
      const toMidnight = Math.max(1, Math.round((24 - hour) * Life.HOUR));
      const end = Math.min(b, a + toMidnight);
      const cur = out.get(day) || { day, at: a, ms: 0 };
      cur.ms += end - a;
      out.set(day, cur);
      a = end;
    }
  }
  return [...out.values()];
}

/** Corta os segmentos na janela elegível (os primeiros `maxMin` minutos ativos). */
function clipSegments(segments, maxMs) {
  const out = [];
  let left = maxMs;
  for (const seg of [...(segments || [])].sort((x, y) => x.from - y.from)) {
    if (left <= 0) break;
    const len = Math.max(0, seg.to - seg.from);
    const take = Math.min(len, left);
    if (take > 0) out.push({ from: seg.from, to: seg.from + take });
    left -= take;
  }
  return out;
}

/**
 * Prática de uma atividade sobre o estado da vida `s` (já simulado até agora).
 * Cada dia gasta o próprio orçamento. Devolve { attrs: {k: ganho real},
 * base: {k: base pedido}, activeMs }.
 */
function practice(s, activity, segments, mult = 1) {
  const def = ACTIVITIES[activity];
  if (!def) throw new Error(`atividade desconhecida: ${activity}`);
  const clipped = clipSegments(segments, def.maxMin * MIN_MS);
  const attrs = {};
  const base = {};
  let activeMs = 0;
  for (const part of splitByDay(clipped)) {
    activeMs += part.ms;
    const tens = (part.ms / (10 * MIN_MS)) * Math.max(0, Number(mult) || 0);
    for (const [role, k] of [["main", def.main], ["sec", def.sec]]) {
      if (!k) continue;
      const b = PER_10MIN[role] * tens;
      base[k] = (base[k] || 0) + b;
      const got = Life.gain(s, k, b, part.at);
      attrs[k] = (attrs[k] || 0) + got;
    }
  }
  for (const k of Object.keys(attrs)) attrs[k] = Math.round(attrs[k] * 10000) / 10000;
  return { attrs, base, activeMs };
}

/** XP de um minijogo pelo tempo ativo elegível. */
function minigameXp(activeMs) {
  return Math.round(XP_GAIN.minigamePer10 * (activeMs / (10 * MIN_MS)));
}

/** XP de uma luta. */
function fightXp(kind, level, win) {
  if (!win) return XP_GAIN.fightLoss;
  const b = XP_GAIN.fightWin[kind] || 30;
  return Math.round(b * (1 + XP_GAIN.fightLevelMul * (Math.max(1, level) - 1)));
}

/**
 * Custo persistente de uma luta já validada. `lossesToday` = derrotas seguidas
 * antes desta. Aplica em `s` e devolve o delta EFETIVO (depois dos limites).
 */
function applyFightCost(s, win, lossesToday, tutorial = false) {
  if (tutorial) return { energy: 0, stress: 0 };
  const c = win ? FIGHT_COST.win : FIGHT_COST.loss;
  const stress = !win && lossesToday + 1 >= FIGHT_COST.calmAfter ? 0 : c.stress;
  const e0 = s.energy;
  const s0 = s.stress;
  s.energy = Math.max(0, Math.min(100, s.energy + c.energy));
  s.stress = Math.max(0, Math.min(100, s.stress + stress));
  return { energy: Math.round((s.energy - e0) * 100) / 100, stress: Math.round((s.stress - s0) * 100) / 100 };
}

// ═══ B5: INVENTÁRIO DE MONSTROS ═══ — que luta conta e com que nome.
// Arena ('laminas') e rua ('mob'); o ringue do Boxe (humanos) e o prólogo não.
// F1 (lore v2): os tipos da luta com os ids novos — cavaleiro (Soldado de Pedra/Cavaleiro Dourado),
// stone (Golem de Pedra), ciborgue, garras. Os antigos (soldier/golem/harpy) viraram estes na mig 436.
const TROPHY_KINDS = Object.freeze(["cavaleiro", "stone", "wolf", "ciborgue", "garras", "brute"]);
function trophyKind(origin, kind) {
  if (origin !== "laminas" && origin !== "mob") return null;
  return TROPHY_KINDS.includes(kind) ? kind : null;
}

module.exports = {
  ruler,
  STREET_FACTORS,
  levelForFactor,
  dropPace,
  pacedDrop,
  RULES_VERSION,
  XP,
  xpToNext,
  levelOf,
  UNLOCKS,
  ACTIVITIES,
  PER_10MIN,
  XP_GAIN,
  FIGHT_COST,
  OUTCOME,
  CONDITION,
  conditionFactor,
  fightGainMult,
  splitByDay,
  clipSegments,
  practice,
  minigameXp,
  fightXp,
  applyFightCost,
  FIGHT_DROP,
  fightDropAvg,
  dropCondition,
  rollFightDrop,
  COINS,
  fightCoins,
  rollMobLevel,
  minigameCoins,
  TROPHY_KINDS,
  trophyKind,
};
