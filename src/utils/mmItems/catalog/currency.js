// src/utils/mmItems/catalog/currency.js — FICHAS (pilha mostrada como saldo; nunca carteira nova).
// Pó de Refino e Selo de Domínio moram em lines.js (E8). Trilha E17: a ficha de cada minijogo e a do
// Hall (o Hall é PvP: só paga ficha, A10). Trocam-se na loja de troca (catalog/exchange.js).
"use strict";

const { G } = require("./_base");
const { GAMES, GAME_NAME } = require("./exchange");

const TOKENS = [...GAMES, "hall"];
const ARTICLE = Object.freeze({ corrida: "da", gincana: "da" });
const ITEMS = Object.freeze(TOKENS.map((g) => G(`ficha_${g}`, "currency", `Ficha ${ARTICLE[g] || "do"} ${GAME_NAME[g]}`, "common", {
  stack: true, sell: 0, use: null, action: null, token: g,
  notes: Object.freeze([`Troque na Loja de troca (dentro da Loja) por materiais, runas e Selos.`]),
})));
const DESCRIPTIONS = Object.freeze(Object.fromEntries(TOKENS.map((g) => [`ficha_${g}`,
  g === "hall" ? "Ficha de quem desafia o Hall dos Campeões. Só serve na Loja de troca." : `Ficha de quem joga ${GAME_NAME[g]}: minutos ativos ÷ 2 por partida, mais 1 se venceu.`])));

module.exports = { ITEMS, DESCRIPTIONS };
