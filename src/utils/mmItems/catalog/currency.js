// src/utils/mmItems/catalog/currency.js — FICHAS (pilha mostrada como saldo; nunca carteira nova).
// Pó de Refino e Selo de Domínio moram em lines.js (E8). Trilha E17: a ficha de cada minijogo e a do
// Hall (o Hall é PvP: só paga ficha, A10). Trocam-se na loja de troca (catalog/exchange.js).
"use strict";

const { G } = require("./_base");
const { GAMES, GAME_NAME } = require("./exchange");

// E19: a ficha de evento (paga por toda atividade validada com um evento ligado)
const TOKENS = [...GAMES, "hall", "evento"];
const ARTICLE = Object.freeze({ corrida: "da", gincana: "da" });
const ITEMS = Object.freeze(TOKENS.map((g) => G(`ficha_${g}`, "currency", `Ficha ${ARTICLE[g] || "do"} ${GAME_NAME[g]}`, "common", {
  stack: true, sell: 0, use: null, action: null, token: g,
  notes: Object.freeze([g === "evento" ? "Troque na loja do evento enquanto ele estiver ligado; fora dele, a ficha fica guardada." : `Troque na Loja de troca (dentro da Loja) por materiais, runas e Selos.`]),
  // E19: a de evento não sai de tabela — toda atividade validada paga enquanto o admin deixa o evento ligado
  ...(g === "evento" ? { source: Object.freeze(["Eventos: toda luta, minijogo e Domínio validado paga, enquanto o evento estiver ligado."]) } : {}),
})));
const DESCRIPTIONS = Object.freeze(Object.fromEntries(TOKENS.map((g) => [`ficha_${g}`,
  g === "hall" ? "Ficha de quem desafia o Hall dos Campeões. Só serve na Loja de troca." : g === "evento" ? "Ficha que toda atividade paga enquanto um evento está ligado. Só serve na loja do evento." : `Ficha de quem joga ${GAME_NAME[g]}: minutos ativos ÷ 2 por partida, mais 1 se venceu.`])));

module.exports = { ITEMS, DESCRIPTIONS };
