// src/utils/mmItems/rules/rank.js — CLASSE DE RARIDADE dos itens (decisão do Alex, 2026-11-17).
//
// A raridade que o jogador VÊ é uma classe em letras de gacha, da mais fraca à mais forte:
//   E · D · C · B · A · S · SS · SSR · Lendária · Divina
// (Divina: as primeiras chegaram em 22/11/2026 — catalog/weaponsTripo.js, com `rank: "divine"` explícito.)
//
// `rarity` (common…mythic) continua existindo por dentro: é a régua do orçamento de poder (`budget.TIER`),
// do peso no sorteio e do número de fragmentos. Ninguém vê `rarity` na tela; a tela lê `rank`.
//
// Como cada item ganha a classe (`rankOf`):
//   1. arma de linha (`line: true`, a arma de um deus) → Lendária;
//   2. arma e escudo → pelo NÍVEL: 1=E, 2=D, 3=C, 4=B, 5=A, 6=S, 7–8=SS, 9–10=SSR (acima de 10 = SSR);
//   3. o resto (proteção, acessório, material, fragmento, receita, consumível…) → pela raridade interna,
//      no mesmo ponto em que a loja de armas a usava: common=E, uncommon=D, rare=B, epic=S,
//      legendary=Lendária, mythic=Divina.
//   `o.rank` explícito no construtor vence tudo.
"use strict";

const RANKS = Object.freeze(["E", "D", "C", "B", "A", "S", "SS", "SSR", "legendary", "divine"]);
/** Posição na escala (0 = E … 9 = Divina), para ordenar e comparar. */
const RANK_ORDER = Object.freeze(Object.fromEntries(RANKS.map((r, i) => [r, i])));

const BY_LEVEL = Object.freeze(["E", "E", "D", "C", "B", "A", "S", "SS", "SS", "SSR", "SSR"]); // índice = nível
const BY_RARITY = Object.freeze({ common: "E", uncommon: "D", rare: "B", epic: "S", legendary: "legendary", mythic: "divine" });

/** Classe pelo nível de uma arma/escudo da escala de 10 degraus. */
function rankByLevel(level) {
  const n = Math.max(1, Math.floor(Number(level) || 1));
  return n >= 10 ? "SSR" : BY_LEVEL[n];
}

/** Classe pela raridade interna (itens fora da escala de armas). */
const rankByRarity = (rarity) => BY_RARITY[rarity] || "E";

/** Classe de um item do catálogo (campos do construtor `G`). */
function rankOf(item) {
  if (!item) return "E";
  if (item.rank && RANKS.includes(item.rank)) return item.rank;
  if (item.line) return "legendary";
  if (item.category === "weapon" || item.category === "shield") return rankByLevel(item.level);
  return rankByRarity(item.rarity);
}

module.exports = { RANKS, RANK_ORDER, rankOf, rankByLevel, rankByRarity };
