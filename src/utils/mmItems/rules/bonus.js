// src/utils/mmItems/rules/bonus.js — trilha E, fatia E7: BÔNUS v2 do equipamento (§6.4).
//
// Nada é escrito à mão: cada peça soma budget.piece() nas DUAS chaves dela (principal com ênfase 1,
// secundária com 0,5), separado por fonte (base pela raridade, aprimoramento, refinamento); depois
// o conjunto. Cada fonte tem subteto (a fatia dela do teto) e a soma tem o teto da chave.
// E13: as RUNAS engastadas (`sockets` da cópia) entram na fatia `runes` (subteto CAP × 0,10).
// E14: a cópia DESPERTA soma a fatia `awaken` na chave principal (pesada pelo slot; rules/ascend.js).
// E15: a cópia ENCANTADA troca a chave secundária (`enchant`) e soma a fatia `enchant` nela (rules/enchant.js).
"use strict";

const B = require("./budget");
const Runes = require("./runes");
const Ascend = require("./ascend");
const Enchant = require("./enchant");

const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * `pieces` = [{ item, plus, grade, sockets, awakened, enchant }] (item do catálogo, com `slot`, `rarity`, `keys`, `set`;
 * `sockets` = ids das runas engastadas na cópia; `awakened` = cópia desperta, E14; `enchant` = chave secundária encantada, E15).
 * `sets` = catálogo de conjuntos; `steps` = { nº de peças: fração da fatia }.
 * Devolve { bonus: { chave: fração }, sources: { chave: { base, plus, grade, set, runes, awaken, enchant } }, sets: { id: nº } }.
 */
function bonusOf(pieces, { sets = [], steps = {} } = {}) {
  const src = Object.fromEntries(B.KEYS.map((k) => [k, { base: 0, plus: 0, grade: 0, set: 0, runes: 0, awaken: 0, enchant: 0 }]));
  const count = {};
  for (const p of pieces) {
    const it = p && p.item;
    if (!it || !it.slot || !Array.isArray(it.keys)) continue;
    Enchant.effectiveKeys(it, p.enchant).forEach((k, i) => {
      if (!src[k]) return;
      const parts = B.pieceParts(k, it.slot, it.rarity, p.plus || 0, p.grade || 1, i === 0 ? 1 : B.SECONDARY);
      for (const s of B.PIECE_SOURCES) src[k][s] += parts[s];
    });
    if (it.set) count[it.set] = (count[it.set] || 0) + 1;
    for (const [k, v] of Object.entries(Runes.runeSum(p.sockets))) if (src[k]) src[k].runes += v;
    if (p.awakened) for (const [k, v] of Object.entries(Ascend.awakenValue(it))) if (src[k]) src[k].awaken += v;
    if (p.enchant) for (const [k, v] of Object.entries(Enchant.enchantValue(it, Enchant.effectiveKeys(it, p.enchant)[1] === p.enchant ? p.enchant : null))) if (src[k]) src[k].enchant += v;
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

/**
 * Bônus de UMA peça (para o cartão: +0 grau I, ou o plus/grau da cópia). `extra.sockets` (E13) soma as
 * runas engastadas na cópia, `extra.awakened` (E14) a passiva e `extra.enchant` (E15) a chave encantada
 * (cada fonte no seu subteto).
 */
function pieceBonus(item, plus = 0, grade = 1, extra = {}) {
  const out = {};
  if (!item || !item.slot || !Array.isArray(item.keys)) return out;
  const keys = Enchant.effectiveKeys(item, extra.enchant);
  keys.forEach((k, i) => {
    out[k] = r4((out[k] || 0) + B.piece(k, item.slot, item.rarity, plus, grade, i === 0 ? 1 : B.SECONDARY));
  });
  for (const [k, v] of Object.entries(Runes.runeSum(extra.sockets))) out[k] = r4((out[k] || 0) + Math.min(v, B.sourceCap(k, "runes")));
  if (extra.awakened) for (const [k, v] of Object.entries(Ascend.awakenValue(item))) out[k] = r4((out[k] || 0) + Math.min(v, B.sourceCap(k, "awaken")));
  if (extra.enchant && keys[1] === extra.enchant) for (const [k, v] of Object.entries(Enchant.enchantValue(item, extra.enchant))) out[k] = r4((out[k] || 0) + Math.min(v, B.sourceCap(k, "enchant")));
  return out;
}

module.exports = { bonusOf, pieceBonus };
