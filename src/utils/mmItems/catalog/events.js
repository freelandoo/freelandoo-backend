// src/utils/mmItems/catalog/events.js — trilha E, fatia E19: EVENTOS.
//
// O admin liga e desliga (tb_mm_event, mig 451). Com um evento ligado, toda atividade validada (luta,
// minijogo, rua, Domínio) paga também `ficha_evento` — a mesma conta das fichas (minutos ativos ÷ 2 +
// 1 se venceu) — e a loja de evento (ofertas `event` em catalog/exchange.js) abre. Desligado, a ficha
// fica guardada para o próximo evento.
"use strict";

const EVENTS = Object.freeze([
  Object.freeze({ id: "festa_lumen", name: "Festa de Lúmen" }),
]);
const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
const EVENT_TOKEN = "ficha_evento";
/** Tabelas que pagam a ficha de evento (baú não paga). */
const PAYS_EVENT = (table) => /^(fight|minigame|mob|domain):/.test(String(table || ""));

module.exports = { EVENTS, EVENT_BY_ID, EVENT_TOKEN, PAYS_EVENT };
