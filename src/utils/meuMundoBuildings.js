// src/utils/meuMundoBuildings.js — MEU MUNDO 3D, lore v2 F6: prédios por nível do TREINADOR.
//
// ESPELHO de features/meu-mundo/buildings.ts no front (test/unit/meuMundoBuildings
// confere). O SERVIDOR é quem recusa (MeuMundoBuildingService.gate nas rotas de
// cada prédio); o cliente só desenha o cadeado. Administrador passa direto.
//
// Decisão do Alex (B13b, 09/11): a 1ª sessão abre Laboratório, casa, mercado e
// comida, academia e treino; nível 5 abre os minijogos; nível 10 abre o Hall
// (a Arena das Lâminas é o Hall da Fama), o Laboratório completo (embrião e
// acelerador) e o mercado de personagens; o resto é meta longa. Hospital e
// Delegacia nunca fecham (a vida leva a pessoa para lá). "O resto" abre no
// nível 8, o do capítulo 4 ("Ferro"), que é quem usa estudo, Forja e Arsenal
// (recomendação; ajuste aqui E no front).
"use strict";

const BUILDING_LEVELS = Object.freeze({
  // 1ª sessão
  criolab: 1,
  supermercado: 1,
  pizzaria: 1,
  hamburgueria: 1,
  academia: 1,
  hospital: 1,
  delegacia: 1,
  // nível 5: os minijogos (o Boxe é minijogo)
  jetpack: 5,
  paint: 5,
  corrida: 5,
  noturno: 5,
  gincana: 5,
  boxe: 5,
  // meta longa: o nível do capítulo 4
  universidade: 8,
  escola: 8,
  biblioteca: 8,
  forja: 8,
  arsenal: 8,
  igreja: 8,
  // nível 10: o Hall
  laminas: 10,
});

/** Partes de um prédio que abrem depois dele. */
const FEATURE_LEVELS = Object.freeze({
  // Laboratório completo: embrião, genética e acelerador
  lab_full: 10,
  // mercado de personagens entre jogadores (a tela ainda não existe)
  char_market: 10,
});

/** Nunca fecham, qualquer que seja a tabela (casa, comida, Laboratório, hospital, delegacia). */
const ALWAYS_OPEN = Object.freeze(["criolab", "supermercado", "pizzaria", "hamburgueria", "hospital", "delegacia"]);

const minLevelOf = (id) => (ALWAYS_OPEN.includes(id) ? 1 : BUILDING_LEVELS[id] || 1);
const featureLevelOf = (f) => FEATURE_LEVELS[f] || 1;
const isOpen = (id, level, bypass = false) => bypass || Number(level) >= minLevelOf(id);

/**
 * Uma missão curta por prédio quando ele abre, mostrando como funciona.
 * Mesmo motor dos capítulos (check de MeuMundoQuestService.satisfied), guardada
 * em tb_mm_quest com quest_id "pr_<id>". XP 0 até o Alex decidir o valor
 * (proposta: 30 por missão).
 */
const BUILDING_QUESTS = Object.freeze(
  [
    { id: "pr_minijogos", minLevel: 5, place: "jetpack", check: "games:1", xp: 0 },
    { id: "pr_estudo", minLevel: 8, place: "universidade", check: "practice:studying", xp: 0 },
    { id: "pr_forja", minLevel: 8, place: "forja", check: "forge", xp: 0 },
    { id: "pr_arsenal", minLevel: 8, place: "arsenal", check: "visit:arsenal", xp: 0 },
    { id: "pr_igreja", minLevel: 8, place: "igreja", check: "practice:praying", xp: 0 },
    { id: "pr_hall", minLevel: 10, place: "laminas", check: "hallChallenge", xp: 0 },
    { id: "pr_laboratorio", minLevel: 10, place: "criolab", check: "ack", xp: 0 },
  ].map((q) => Object.freeze(q))
);
const BUILDING_QUEST_BY_ID = new Map(BUILDING_QUESTS.map((q) => [q.id, q]));

module.exports = { BUILDING_LEVELS, FEATURE_LEVELS, ALWAYS_OPEN, minLevelOf, featureLevelOf, isOpen, BUILDING_QUESTS, BUILDING_QUEST_BY_ID };
