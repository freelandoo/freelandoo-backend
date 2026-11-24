// src/utils/mmItems/catalog/exchange.js — trilha E, fatia E17: LOJA DE TROCA (fichas → itens).
//
// Cada minijogo paga a sua ficha (`ficha_<jogo>`: minutos ativos ÷ 2, arredondado, + 1 se venceu —
// catalog/loot.js, qty `tokens`). O Hall é PvP e só paga ficha (A10). A loja troca fichas por itens de
// progressão; o item mais caro custa entre 40 e 60 partidas (TOKENS_PER_MATCH fichas por partida típica).
// A E19 acrescenta a ficha e a loja de evento (`event: true`, ligada pelo admin).
// Oferta: { id, token, cost, gives: { item: qtd } }. Quem confere saldo e grava o recibo é o serviço.
"use strict";

/** Fichas de uma partida típica (4 a 6 minutos, metade vencida): 2 a 3 + 0,5. */
const TOKENS_PER_MATCH = 3;
const GAMES = Object.freeze(["paint", "jetpack", "noturno", "corrida", "gincana"]);
const GAME_NAME = Object.freeze({ paint: "Paint", jetpack: "Jetpack", noturno: "Rolê Noturno", corrida: "Antigravidade", gincana: "Gincana", hall: "Hall dos Campeões", evento: "Evento" });
/** A runa que cada minijogo vende (a de Acuracidade fica só nos Domínios e no Hall). */
const GAME_RUNE = Object.freeze({ paint: "destreza", jetpack: "velocidade", noturno: "vitalidade", corrida: "inteligencia", gincana: "defesa" });

const offer = (token, id, cost, gives) => Object.freeze({ id: `${token}:${id}`, token: `ficha_${token}`, cost, gives: Object.freeze(gives) });

/**
 * O que toda loja de minijogo vende (progressão comum; nada de equipamento pronto). weapon-v1 (24/11/2026):
 * pós das faixas baixas e fragmentos das classes baixas (caminho previsível, sem depender só de sorte);
 * Pedra, Catalisador, Essência, Selo, Minério e runas saíram com a forja antiga.
 */
function common(game) {
  return [
    offer(game, "po_forja", 6, { po_forja: 2 }),
    offer(game, "madeira", 10, { madeira_ancestral: 1 }),
    offer(game, "po_d", 4, { po_ref_d: 1 }),
    offer(game, "po_c", 8, { po_ref_c: 1 }),
    offer(game, "po_b", 14, { po_ref_b: 1 }),
    offer(game, "frag_e", 9, { frag_classe_e: 3 }),
    offer(game, "frag_d", 15, { frag_classe_d: 3 }),
    offer(game, "frag_c", 24, { frag_classe_c: 3 }),
    // o mais caro fica em 40 partidas (regra da E17): o pó A, que sobe a arma do 31 ao 40
    offer(game, "po_a", 120, { po_ref_a: 1 }),
  ];
}

const OFFERS = Object.freeze([
  ...GAMES.flatMap(common),
  // Hall (PvP): a ficha compra pós altos e fragmentos das classes de cima
  offer("hall", "po_a", 20, { po_ref_a: 1 }),
  offer("hall", "po_s", 30, { po_ref_s: 1 }),
  offer("hall", "po_ss", 50, { po_ref_ss: 1 }),
  offer("hall", "frag_ss", 60, { frag_classe_ss: 2 }),
  offer("hall", "frag_legendary", 90, { frag_classe_legendary: 2 }),
  // E19: loja de evento (só abre com o evento ligado pelo admin)
  ...[
    offer("evento", "cosmetico_rastro", 40, { rastro_eter: 1 }),
    offer("evento", "po_sss1", 30, { po_ref_sss1: 1 }),
    offer("evento", "po_sss2", 50, { po_ref_sss2: 1 }),
    offer("evento", "po_sss3", 80, { po_ref_sss3: 1 }),
    offer("evento", "frag_ssr", 40, { frag_classe_ssr: 2 }),
    offer("evento", "frag_divine", 120, { frag_classe_divine: 2 }),
  ].map((o) => Object.freeze({ ...o, id: o.id.replace("evento:", "festa_lumen:"), event: "festa_lumen" })),
]);
const OFFER_BY_ID = new Map(OFFERS.map((o) => [o.id, o]));

module.exports = { TOKENS_PER_MATCH, GAMES, GAME_NAME, GAME_RUNE, OFFERS, OFFER_BY_ID };
