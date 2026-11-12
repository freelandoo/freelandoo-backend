// src/utils/mmItems/rules/runes.js — trilha E, fatia E13: RUNAS (engaste e fusão), regra pura.
//
// §6.5 do plano 2026-11-11-itens-equipamentos-e-progressao.md:
//   runa de grau g na chave k soma CAP[k] × SHARE.runes × (g ÷ 5) ÷ 8   (subteto: CAP[k] × SHARE.runes)
//   fusão: 3 de grau N → 1 de grau N+1 (grau V = 81 de grau I)
//   engastes: raro 1 · épico 2 · lendário 2 · mítico 3; comum e incomum 0. A Ascensão (E14) soma 1
//   engaste à peça (teto 3) — é o "+1 ascendido" do lendário estendido a toda peça ascendida.
// Uma runa vale em QUALQUER slot (a chave é da runa, não da peça). Quem confere posse e recibo é o serviço.
"use strict";

const B = require("./budget");

/** Nome da runa no id → chave da régua. */
const RUNE_KINDS = Object.freeze({
  ataque: "dmg", defesa: "def", forca: "acc", inteligencia: "int", destreza: "dex", velocidade: "spd", vitalidade: "hp",
});
const KIND_OF_KEY = Object.freeze(Object.fromEntries(Object.entries(RUNE_KINDS).map(([n, k]) => [k, n])));
const GRADES = 5;
const FUSE_IN = 3;
/** Runas que dividem a fatia: 8 (um engaste "médio" por slot). */
const RUNE_DIVISOR = 8;
const RARITY_OF_GRADE = Object.freeze(["common", "uncommon", "rare", "epic", "legendary"]);
const SOCKETS = Object.freeze({ common: 0, uncommon: 0, rare: 1, epic: 2, legendary: 2, mythic: 3 });
const MAX_SOCKETS = 3;

const runeId = (kind, grade) => `runa_${kind}_${grade}`;
/** { kind, key, grade } de um id de runa, ou null. */
function parseRune(id) {
  const m = /^runa_([a-z]+)_([1-5])$/.exec(String(id || ""));
  if (!m || !RUNE_KINDS[m[1]]) return null;
  return { kind: m[1], key: RUNE_KINDS[m[1]], grade: Number(m[2]) };
}

/** Valor de UMA runa (fração da ficha) na chave dela. */
const runeValue = (key, grade) => ((B.CAP[key] || 0) * B.SHARE.runes * Math.max(0, Math.min(GRADES, grade))) / GRADES / RUNE_DIVISOR;

/** Engastes de uma peça (pela raridade; ascendida +1, teto 3). Peça sem slot = 0. */
function socketsOf(item, ascended = false) {
  if (!item || !item.slot || !item.tier) return 0;
  const base = SOCKETS[item.rarity] || 0;
  return Math.min(MAX_SOCKETS, base + (ascended ? 1 : 0));
}

/** Soma das runas engastadas, por chave, SEM o subteto (bonus.js aplica o subteto por fonte). */
function runeSum(sockets) {
  const out = {};
  for (const id of Array.isArray(sockets) ? sockets : []) {
    const r = parseRune(id);
    if (r) out[r.key] = (out[r.key] || 0) + runeValue(r.key, r.grade);
  }
  return out;
}

/** Fusão `qty` vezes: { needs, gives } ou { error: "item" | "max" | "owned" }. */
function fuseCost(id, qty = 1) {
  const r = parseRune(id);
  if (!r) return { error: "item" };
  if (r.grade >= GRADES) return { error: "max" };
  const n = Math.floor(Number(qty));
  if (!Number.isInteger(n) || n < 1 || n > 3333) return { error: "owned" };
  return { needs: { [id]: FUSE_IN * n }, gives: { [runeId(r.kind, r.grade + 1)]: n } };
}

module.exports = {
  RUNE_KINDS, KIND_OF_KEY, GRADES, FUSE_IN, RUNE_DIVISOR, RARITY_OF_GRADE, SOCKETS, MAX_SOCKETS,
  runeId, parseRune, runeValue, socketsOf, runeSum, fuseCost,
};
