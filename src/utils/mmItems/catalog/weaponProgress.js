// src/utils/mmItems/catalog/weaponProgress.js — os itens da progressão das armas (weapon-v2, 24/11/2026):
// os 10 PÓS DE REFINAMENTO (um por CLASSE: pó B só refina arma B) e os 10 FRAGMENTOS DE CLASSE (E…Divina).
// A regra (barra de XP, sorteio, quantidades) mora em rules/weaponProgress.js; aqui só os itens e os textos.
// Os pós SSS I/II/III da weapon-v1 ficam no catálogo (recibos antigos), sem origem: viram SSR/Lendária/Divina.
// Os fragmentos se desenham como peça de quebra-cabeça no front, com as thumbs das armas da classe.
"use strict";

const { G } = require("./_base");
const P = require("../rules/weaponProgress");
const { RANKS } = require("../rules/rank");

const RANK_NAME = Object.freeze({ legendary: "Lendária", divine: "Divina" });
const rankName = (r) => RANK_NAME[r] || r;
/** Raridade interna do fragmento (peso no sorteio): segue a classe. */
const FRAG_RARITY = Object.freeze({ E: "common", D: "common", C: "uncommon", B: "uncommon", A: "rare", S: "rare", SS: "epic", SSR: "epic", legendary: "legendary", divine: "mythic" });

const POWDER_ITEMS = P.POWDERS.map((p) => G(p.id, "material", p.name, p.rarity, {
  stack: true, sell: 0, rank: p.rank, powder: Object.freeze({ rank: p.rank }),
}));
/** weapon-v1 (saíram): sem fonte → `retired` no índice; a pilha vira o pó da classe (catalog/retired.js). */
const LEGACY_POWDER_ITEMS = [["po_ref_sss1", "SSS I", "SSR"], ["po_ref_sss2", "SSS II", "legendary"], ["po_ref_sss3", "SSS III", "divine"]]
  .map(([id, n, r]) => G(id, "material", `Pó de Refinamento ${n}`, "legendary", { stack: true, sell: 0, rank: r }));

const FRAGMENT_ITEMS = RANKS.map((r) => G(P.fragmentOf(r), "fragment", `Fragmento de classe ${rankName(r)}`, FRAG_RARITY[r], {
  stack: true, sell: 0, rank: r,
  fragment: Object.freeze({ rank: r, need: P.FRAGMENT_NEED[r] }),
}));

const DESCRIPTIONS = Object.freeze({
  ...Object.fromEntries(P.POWDERS.map((p) => [p.id, `Refina armas de classe ${rankName(p.rank)}: cada unidade é uma tentativa que dá XP ao nível da arma (pode dar muito, pouco ou até tirar). Você aceita ou recusa o resultado.`])),
  ...Object.fromEntries(Object.entries(P.LEGACY_POWDERS).map(([id, to]) => [id, `Saiu do jogo: virou ${to.replace("po_ref_", "Pó ").replace("legendary", "Lendária").replace("divine", "Divina").replace("ssr", "SSR")}.`])),
  ...Object.fromEntries(RANKS.map((r) => [P.fragmentOf(r), `Junte ${P.FRAGMENT_NEED[r]} e escolha na Forja qual arma de classe ${rankName(r)} montar — inclusive uma que você já tem.`])),
});

module.exports = { ITEMS: Object.freeze([...POWDER_ITEMS, ...LEGACY_POWDER_ITEMS, ...FRAGMENT_ITEMS]), POWDER_ITEMS, FRAGMENT_ITEMS, DESCRIPTIONS, rankName };
