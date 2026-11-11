// src/utils/mmItems/rules/bonus.js — trilha E, fatia E7: BÔNUS v2 do equipamento (§6.4).
//
// Nada é escrito à mão: cada peça soma budget.piece() nas DUAS chaves dela (principal com ênfase 1,
// secundária com 0,5), separado por fonte (base pela raridade, aprimoramento, refinamento); depois
// o conjunto. Cada fonte tem subteto (a fatia dela do teto) e a soma tem o teto da chave.
// Runas, despertar e encanto entram nas fatias deles quando existirem (E13–E15).
"use strict";

const B = require("./budget");

const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * `pieces` = [{ item, plus, grade }] (item do catálogo, com `slot`, `rarity`, `keys`, `set`).
 * `sets` = catálogo de conjuntos; `steps` = { nº de peças: fração da fatia }.
 * Devolve { bonus: { chave: fração }, sources: { chave: { base, plus, grade, set } }, sets: { id: nº } }.
 */
function bonusOf(pieces, { sets = [], steps = {} } = {}) {
  const src = Object.fromEntries(B.KEYS.map((k) => [k, { base: 0, plus: 0, grade: 0, set: 0 }]));
  const count = {};
  for (const p of pieces) {
    const it = p && p.item;
    if (!it || !it.slot || !Array.isArray(it.keys)) continue;
    it.keys.forEach((k, i) => {
      if (!src[k]) return;
      const parts = B.pieceParts(k, it.slot, it.rarity, p.plus || 0, p.grade || 1, i === 0 ? 1 : B.SECONDARY);
      for (const s of B.PIECE_SOURCES) src[k][s] += parts[s];
    });
    if (it.set) count[it.set] = (count[it.set] || 0) + 1;
  }
  for (const set of sets) {
    const step = steps[Math.min(4, count[set.id] || 0)] || 0;
    if (step) for (const k of set.keys) if (src[k]) src[k].set += B.sourceCap(k, "set") * step;
  }
  const bonus = {};
  for (const k of B.KEYS) {
    let total = 0;
    for (const [s, v] of Object.entries(src[k])) total += Math.min(v, B.sourceCap(k, s));
    bonus[k] = r4(Math.min(B.CAP[k], total));
  }
  return { bonus, sources: src, sets: count };
}

/** Bônus de UMA peça (para o cartão: +0 grau I, ou o plus/grau da cópia). */
function pieceBonus(item, plus = 0, grade = 1) {
  const out = {};
  if (!item || !item.slot || !Array.isArray(item.keys)) return out;
  item.keys.forEach((k, i) => {
    out[k] = r4((out[k] || 0) + B.piece(k, item.slot, item.rarity, plus, grade, i === 0 ? 1 : B.SECONDARY));
  });
  return out;
}

module.exports = { bonusOf, pieceBonus };
