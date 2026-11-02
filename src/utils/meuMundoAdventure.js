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

const RULES_VERSION = "R1";

// ═══ XP DE AVENTURA ═══ — por pessoa (atravessa gerações).
// Para ir do nível n ao n+1: round(BASE × n^EXP). 1→2 = 100, 2→3 = 303,
// 5→6 = 1314, 10→11 = 3981. O prólogo soma ≥ 420 → garante o nível 3.
const XP = Object.freeze({ BASE: 100, EXP: 1.6, MAX_LEVEL: 60 });

const xpToNext = (n) => Math.round(XP.BASE * Math.pow(n, XP.EXP));

/** Nível pelo XP total: { level, into, need, total }. */
function levelOf(total) {
  let xp = Math.max(0, Math.floor(Number(total) || 0));
  let level = 1;
  while (level < XP.MAX_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
  }
  return { level, into: xp, need: level >= XP.MAX_LEVEL ? 0 : xpToNext(level), total: Math.max(0, Math.floor(Number(total) || 0)) };
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
  laminas: { main: "strength", sec: "dexterity", maxMin: 6, loot: "forja" },
  boxe: { main: "strength", sec: "dexterity", maxMin: 6, loot: "couro" },
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
  fightWin: { soldier: 30, wolf: 45, golem: 50, harpy: 55, brute: 80 },
  fightLevelMul: 0.5, // +50% por nível acima do 1
  fightLoss: 10,
});

// ═══ CUSTO DA LUTA (energia/estresse persistentes) ═══
const FIGHT_COST = Object.freeze({
  win: { energy: -5, stress: 0 },
  loss: { energy: -8, stress: 5 },
  /** A partir da 3ª derrota seguida no dia: sem estresse (não empilha punição). */
  calmAfter: 3,
});

const MIN_MS = 60000;

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
function practice(s, activity, segments) {
  const def = ACTIVITIES[activity];
  if (!def) throw new Error(`atividade desconhecida: ${activity}`);
  const clipped = clipSegments(segments, def.maxMin * MIN_MS);
  const attrs = {};
  const base = {};
  let activeMs = 0;
  for (const part of splitByDay(clipped)) {
    activeMs += part.ms;
    const tens = part.ms / (10 * MIN_MS);
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

module.exports = {
  RULES_VERSION,
  XP,
  xpToNext,
  levelOf,
  UNLOCKS,
  ACTIVITIES,
  PER_10MIN,
  XP_GAIN,
  FIGHT_COST,
  splitByDay,
  clipSegments,
  practice,
  minigameXp,
  fightXp,
  applyFightCost,
};
