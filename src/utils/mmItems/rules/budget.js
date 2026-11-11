// src/utils/mmItems/rules/budget.js — trilha E, fatia E0: RÉGUA DE ORÇAMENTO do equipamento.
//
// Regra pura, sem banco e SEM USO ainda: nenhuma regra em jogo lê este arquivo na E0. A E4 liga as
// chaves novas na ficha, a E7 passa todo bônus de equipamento a sair de `piece()` e a E9 usa
// `WINS`/`STONES`/`REF` no aprimoramento garantido.
//
// Plano: MEU MUNDO 3D/planos/2026-11-11-itens-equipamentos-e-progressao.md, §6.4 e §6.5.
// Contas: scripts/mm-balance.js · invariantes: test/unit/meuMundoEquidade.test.js (I3).
//
//   bônus da peça na chave k = CAP[k] · WEIGHT[k][slot] · ênfase ·
//                              ( SHARE.base · RARITY[raridade] + SHARE.plus · plus/15 + SHARE.grade · (grau−1)/4 )
//
// Uma peça carrega DUAS chaves do slot: a principal (ênfase 1) e a secundária (ênfase 0,5).
"use strict";

/** Teto somado de cada chave (fração sobre a ficha do nível). */
const CAP = Object.freeze({ dmg: 0.35, def: 0.25, hp: 0.25, acc: 0.2, spd: 0.15, int: 0.15, dex: 0.15, stam: 0.12, warn: 0.12, power: 0.18 });
const KEYS = Object.freeze(Object.keys(CAP));

/** Fatia do teto de cada fonte (soma 1). Cada fonte tem subteto = CAP[k] × SHARE[fonte]. */
const SHARE = Object.freeze({ base: 0.4, plus: 0.2, grade: 0.1, set: 0.1, runes: 0.1, awaken: 0.05, enchant: 0.05 });
/** Fontes que moram na peça (o resto é conjunto, runa, despertar e encanto). */
const PIECE_SOURCES = Object.freeze(["base", "plus", "grade"]);

/** Peso de cada slot na parte das peças de uma chave (cada linha soma 1). */
const WEIGHT = Object.freeze({
  dmg: Object.freeze({ weapon: 0.7, gloves: 0.15, amulet: 0.15 }),
  def: Object.freeze({ chest: 0.3, offhand: 0.3, helm: 0.2, boots: 0.1, gloves: 0.1 }),
  hp: Object.freeze({ chest: 0.4, helm: 0.25, amulet: 0.2, relic: 0.15 }),
  acc: Object.freeze({ gloves: 0.4, weapon: 0.3, helm: 0.3 }),
  spd: Object.freeze({ boots: 0.6, amulet: 0.2, relic: 0.2 }),
  int: Object.freeze({ helm: 0.4, amulet: 0.3, relic: 0.3 }),
  dex: Object.freeze({ gloves: 0.5, boots: 0.2, relic: 0.3 }),
  stam: Object.freeze({ boots: 0.4, chest: 0.3, amulet: 0.3 }),
  warn: Object.freeze({ helm: 0.5, relic: 0.5 }),
  power: Object.freeze({ weapon: 0.4, relic: 0.4, amulet: 0.2 }),
});
/** Os 8 slots da A4. */
const SLOTS = Object.freeze(["weapon", "offhand", "helm", "chest", "gloves", "boots", "amulet", "relic"]);

/** Fator da raridade sobre a fatia base. */
const RARITY = Object.freeze({ common: 0.3, uncommon: 0.45, rare: 0.6, epic: 0.75, legendary: 0.88, mythic: 1 });
const RARITIES = Object.freeze(Object.keys(RARITY));
/** Tier pela raridade (comum T1 … mítico T6). */
const TIER = Object.freeze({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 });

const PLUS_MAX = 15;
const GRADE_MAX = 5;
const SECONDARY = 0.5;

/** Chaves que um slot aceita, da de maior peso para a de menor. */
function slotKeys(slot) {
  return KEYS.filter((k) => WEIGHT[k][slot]).sort((a, b) => WEIGHT[b][slot] - WEIGHT[a][slot] || KEYS.indexOf(a) - KEYS.indexOf(b));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Bônus de UMA peça numa chave, separado por fonte (base, aprimoramento, refinamento). */
function pieceParts(k, slot, rarity, plus = 0, grade = 1, emphasis = 1) {
  const w = (CAP[k] || 0) * ((WEIGHT[k] && WEIGHT[k][slot]) || 0) * emphasis;
  const p = clamp(Math.floor(plus) || 0, 0, PLUS_MAX);
  const g = clamp(Math.floor(grade) || 1, 1, GRADE_MAX);
  return {
    base: w * SHARE.base * (RARITY[rarity] || 0),
    plus: (w * SHARE.plus * p) / PLUS_MAX,
    grade: (w * SHARE.grade * (g - 1)) / (GRADE_MAX - 1),
  };
}

/** Bônus de UMA peça numa chave (fração). Chave fora do slot = 0. */
function piece(k, slot, rarity, plus = 0, grade = 1, emphasis = 1) {
  const s = pieceParts(k, slot, rarity, plus, grade, emphasis);
  return s.base + s.plus + s.grade;
}

/** Subteto de uma fonte numa chave. */
const sourceCap = (k, source) => (CAP[k] || 0) * (SHARE[source] || 0);

/** Build todo focado na chave k: as peças de todos os slots dela no máximo + as fontes de fora da peça cheias. */
function focusedBuild(k) {
  const parts = { base: 0, plus: 0, grade: 0 };
  for (const slot of Object.keys(WEIGHT[k])) {
    const s = pieceParts(k, slot, "mythic", PLUS_MAX, GRADE_MAX, 1);
    for (const src of PIECE_SOURCES) parts[src] += s[src];
  }
  const outside = { set: sourceCap(k, "set"), runes: sourceCap(k, "runes"), awaken: sourceCap(k, "awaken"), enchant: sourceCap(k, "enchant") };
  const pieces = parts.base + parts.plus + parts.grade;
  return { parts: { ...parts, ...outside }, pieces, total: pieces + outside.set + outside.runes + outside.awaken + outside.enchant };
}

// ── custos do aprimoramento (§6.5) ──

/** Aprimoramento +1…+15: vitórias do nível de referência para pagar cada passo em Esmeraldas. */
const WINS = Object.freeze([3, 5, 8, 12, 16, 22, 28, 36, 45, 55, 70, 85, 100, 120, 140]);
/** Pedras de Aprimoramento de cada passo (total 135). */
const STONES = Object.freeze([1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 26]);
/** Nível de referência de cada tier. */
const REF = Object.freeze({ 1: 1, 2: 5, 3: 10, 4: 18, 5: 28, 6: 40 });
/** Pedra que cai por vitória em conteúdo do tier. */
const STONE_PER_WIN = 0.5;
/** +11 em diante só depois da Ascensão. */
const ASCEND_FROM = 11;

/** Esmeraldas que uma vitória paga contra monstro do nível L (regra de hoje). */
const income = (L) => 10 * (1 + 0.4 * (L - 1));
/** Esmeraldas do passo n (1…15) num item do tier, arredondado a 10. */
const upgradeEmeralds = (tier, n) => Math.round((WINS[n - 1] * income(REF[tier])) / 10) * 10;

module.exports = {
  CAP, KEYS, SHARE, PIECE_SOURCES, WEIGHT, SLOTS, RARITY, RARITIES, TIER, PLUS_MAX, GRADE_MAX, SECONDARY,
  slotKeys, pieceParts, piece, sourceCap, focusedBuild,
  WINS, STONES, REF, STONE_PER_WIN, ASCEND_FROM, income, upgradeEmeralds,
};
