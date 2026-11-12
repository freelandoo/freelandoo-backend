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

/** O que toda loja de minijogo vende (progressão comum; nada de equipamento pronto). */
function common(game) {
  return [
    offer(game, "minerio", 6, { minerio_ferro: 3 }),
    offer(game, "po_forja", 6, { po_forja: 2 }),
    offer(game, "pedra", 8, { pedra_aprimoramento: 1 }),
    offer(game, "madeira", 10, { madeira_ancestral: 1 }),
    offer(game, "runa", 30, { [`runa_${GAME_RUNE[game]}_1`]: 1 }),
    offer(game, "catalisador", 60, { catalisador_refino: 1 }),
    offer(game, "essencia", 120, { essencia_primordial: 1 }),
    offer(game, "selo", 150, { selo_dominio: 1 }),
  ];
}

const OFFERS = Object.freeze([
  ...GAMES.flatMap(common),
  // Bastor: o Paint também troca o que a linha dele pede
  offer("paint", "barro", 12, { barro_primordial: 2 }),
  offer("paint", "frag_moldes", 30, { frag_cajado_moldes: 3 }),
  offer("paint", "receita_moldes", 90, { receita_cajado_moldes: 1 }),
  // Hall (PvP): a ficha compra o caminho de Aurion; a Arena das Lâminas também paga (I10)
  offer("hall", "brasa", 12, { brasa_solar: 2 }),
  offer("hall", "frag_chama", 30, { frag_primeira_chama: 3 }),
  offer("hall", "receita_chama", 90, { receita_primeira_chama: 1 }),
  offer("hall", "runa_forca", 30, { runa_forca_1: 1 }),
  // E19: loja de evento (só abre com o evento ligado pelo admin)
  ...[
    offer("evento", "cosmetico_rastro", 40, { rastro_eter: 1 }),
    offer("evento", "runa_forca_2", 40, { runa_forca_2: 1 }),
    offer("evento", "catalisador", 30, { catalisador_refino: 1 }),
    offer("evento", "essencia", 60, { essencia_primordial: 1 }),
    offer("evento", "selo", 80, { selo_dominio: 1 }),
  ].map((o) => Object.freeze({ ...o, id: o.id.replace("evento:", "festa_lumen:"), event: "festa_lumen" })),
]);
const OFFER_BY_ID = new Map(OFFERS.map((o) => [o.id, o]));

module.exports = { TOKENS_PER_MATCH, GAMES, GAME_NAME, GAME_RUNE, OFFERS, OFFER_BY_ID };
