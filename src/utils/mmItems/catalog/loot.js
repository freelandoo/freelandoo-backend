// src/utils/mmItems/catalog/loot.js — trilha E, fatia E1: SAQUE por família de atividade.
// Movido de meuMundoGear.js sem mudar material nem chance. A E3 troca por tabelas nomeadas por fonte.
"use strict";

/** Família → material comum garantido, incomum (chance) e raro (chance). */
const LOOT = Object.freeze({
  forja: { base: "fragmento_lamina", uncommon: "nucleo_eter", rare: "selo_forja" },
  couro: { base: "couro_reforcado", uncommon: "rebite", rare: null },
  pigmento: { base: "pigmento_eter", uncommon: null, rare: null },
  mola: { base: "mola_precisao", uncommon: null, rare: null },
  vapor: { base: "injetor_vapor", uncommon: null, rare: null },
  capacitor: { base: "capacitor", uncommon: null, rare: null },
  rolamento: { base: "rolamento", uncommon: null, rare: null },
});

/** Texto de "onde conseguir" escrito à mão (a E3 troca por `sourcesOf`, derivado das tabelas). */
const LOOT_SOURCE = Object.freeze({
  fragmento_lamina: "Lâminas e monstros: material básico garantido de uma atividade validada.",
  nucleo_eter: "Vitórias da família forja: chance de 35%; há condensação garantida no ferreiro.",
  selo_forja: "Vitórias da família forja: chance de 6%; há certificação garantida no ferreiro.",
  couro_reforcado: "Boxe: material básico garantido de uma atividade validada.",
  rebite: "Vitórias do Boxe: chance de 35%; também pode ser produzido no ferreiro.",
  pigmento_eter: "Paint: material básico garantido de uma atividade validada.",
  mola_precisao: "Gincana: material básico garantido de uma atividade validada.",
  injetor_vapor: "Jetpack: material básico garantido de uma atividade validada.",
  capacitor: "Antigravidade: material básico garantido de uma atividade validada.",
  rolamento: "Rolê Noturno: material básico garantido de uma atividade validada.",
});

module.exports = { LOOT, LOOT_SOURCE };
