// src/utils/mmItems/catalog/weaponProgress.js — os itens da progressão nova das armas (weapon-v1, 24/11/2026):
// os 9 PÓS DE REFINAMENTO (um por faixa de ~10 níveis) e os 10 FRAGMENTOS DE CLASSE (E…Divina).
// A regra (faixas, chances, quantidades) mora em rules/weaponProgress.js; aqui só os itens e os textos.
// Os fragmentos se desenham como peça de quebra-cabeça no front, com as thumbs das armas da classe.
"use strict";

const { G } = require("./_base");
const P = require("../rules/weaponProgress");
const { RANKS } = require("../rules/rank");

const RANK_NAME = Object.freeze({ legendary: "Lendária", divine: "Divina" });
const rankName = (r) => RANK_NAME[r] || r;
/** Raridade interna do fragmento (peso no sorteio): segue a classe. */
const FRAG_RARITY = Object.freeze({ E: "common", D: "common", C: "uncommon", B: "uncommon", A: "rare", S: "rare", SS: "epic", SSR: "epic", legendary: "legendary", divine: "mythic" });

const POWDER_ITEMS = P.POWDERS.map((p, i) => G(p.id, "material", p.name, p.rarity, {
  stack: true, sell: 0, powder: Object.freeze({ from: i === 0 ? 2 : P.POWDERS[i - 1].upTo + 1, upTo: p.upTo, chance: p.chance }),
  // o pó tem classe própria na tela (D…SSS III), separada da classe das armas
  rank: ["D", "C", "B", "A", "S", "SS"][i] || (i === 6 ? "SSR" : i === 7 ? "legendary" : "divine"),
}));

const FRAGMENT_ITEMS = RANKS.map((r) => G(P.fragmentOf(r), "fragment", `Fragmento de classe ${rankName(r)}`, FRAG_RARITY[r], {
  stack: true, sell: 0, rank: r,
  fragment: Object.freeze({ rank: r, need: P.FRAGMENT_NEED[r] }),
}));

const DESCRIPTIONS = Object.freeze({
  ...Object.fromEntries(P.POWDERS.map((p, i) => [p.id, `Refina armas do nível ${i === 0 ? 1 : P.POWDERS[i - 1].upTo} ao ${p.upTo}: uma unidade por tentativa, ${Math.round(p.chance * 100)}% de chance. Se falhar, o pó se gasta e a arma fica como estava.`])),
  ...Object.fromEntries(RANKS.map((r) => [P.fragmentOf(r), `Junte ${P.FRAGMENT_NEED[r]} e escolha na Forja qual arma de classe ${rankName(r)} montar — inclusive uma que você já tem.`])),
});

module.exports = { ITEMS: Object.freeze([...POWDER_ITEMS, ...FRAGMENT_ITEMS]), POWDER_ITEMS, FRAGMENT_ITEMS, DESCRIPTIONS, rankName };
