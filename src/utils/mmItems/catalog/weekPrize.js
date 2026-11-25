// src/utils/mmItems/catalog/weekPrize.js — legend-v1 (24/11/2026): o PRÊMIO LENDÁRIO da semana dos minijogos.
//
// Pedido do Alex: "nos minijogos, só em disputa multiplayer e ficar em primeiro no ranking; aí na virada da semana
// tem prêmio e recebe uma lendária". Minijogo não dropa nada Lendário na partida: quem fecha a semana em 1º no
// ranking do jogo (só partidas com 2 ou mais pessoas contam, utils/meuMundoScores.js) recebe, no fechamento da
// semana (MeuMundoNectarService.closeWeek, mesma transação do néctar), 180 fragmentos de classe Lendária = uma
// arma Lendária à escolha na Forja. O Paint também paga 45 fragmentos de cada peça do conjunto dos Moldes (Bastor),
// que antes caía com chance na partida (4 semanas em 1º = o conjunto inteiro).
"use strict";

const WP = require("../rules/weaponProgress");

/** Nível do monstro a partir do qual a rua e as Lâminas podem soltar coisa Lendária (= nível da arma Lendária). */
const LEGEND_LEVEL = 27;
/** Primeira semana com prêmio (a de 29/11/2026): a de agora já tinha marca de partida solo. */
const PRIZE_START_WEEK = "2026-11-29";
const GAME_NAME = Object.freeze({ jetpack: "Jetpack", noturno: "Rolê Noturno", corrida: "Antigravidade", gincana: "Gincana", paint: "Paint" });
const LEGEND_FRAG = WP.fragmentOf("legendary");
const BASTOR = Object.freeze(["elmo", "peitoral", "luvas", "botas"].map((w) => `frag_bastor_${w}`));

/** O que o 1º lugar da semana de cada minijogo recebe: [{ id, qty }]. */
const PRIZES = Object.freeze(Object.fromEntries(Object.keys(GAME_NAME).map((g) => [g, Object.freeze([
  Object.freeze({ id: LEGEND_FRAG, qty: WP.FRAGMENT_NEED.legendary }),
  ...(g === "paint" ? BASTOR.map((id) => Object.freeze({ id, qty: 45 })) : []),
])])));

const PRIZE_GAMES = Object.freeze(Object.keys(PRIZES));
const prizeOf = (game) => PRIZES[game] || null;

/** Linhas de "onde conseguir" do item (o catálogo junta com as das tabelas). */
function prizeSourceLines(itemId) {
  const out = [];
  for (const g of PRIZE_GAMES) {
    const p = PRIZES[g].find((x) => x.id === itemId);
    if (p) out.push(`1º lugar da semana no ranking do ${GAME_NAME[g]} (partidas com 2 ou mais jogadores): ${p.qty}.`);
  }
  return out;
}

module.exports = { LEGEND_LEVEL, PRIZE_START_WEEK, PRIZES, PRIZE_GAMES, prizeOf, prizeSourceLines };
