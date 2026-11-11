// src/utils/mmItems/catalog/loot.js — SAQUE.
//
// Trilha E, fatia E3: TABELAS NOMEADAS por fonte (`fight:laminas`, `fight:boxe`, `minigame:<jogo>`;
// depois `mob:<tipo>`, `domain:<id>:<setor>`, `quest:<id>`, `chest:<id>`). Todo saque passa por
// `Items.rollTable` (regra pura) e `MeuMundoRewardService.grant` (porta única). As 7 famílias de
// antes foram escritas como tabelas com as MESMAS quantidades, chances e ordem de sorteio — o
// unit `meuMundoSaque.test.js` compara com a regra antiga em milhares de sorteios.
//
// Forma de uma tabela:
//   label    nome da fonte no "onde conseguir" (linha do garantido)
//   winLabel nome da fonte nas linhas de chance
//   sure     [{ id, qty }]            sempre (qty: [a, b] ou { byMinutes: true, win: n })
//   chance   [{ id, qty, p, win, note }] sorteio na ordem; `win: true` = só na vitória
//   first    [{ id, qty }]            só na primeira vitória (E12)
// `qty.byMinutes`: max(1, min(4, round(minutos ativos / 2))) + `win` se venceu (a regra de antes).
"use strict";

const TABLES = Object.freeze({
  "fight:laminas": {
    label: "Lâminas e monstros", winLabel: "Vitórias da família forja",
    sure: [{ id: "fragmento_lamina", qty: { byMinutes: true, win: 1 } }],
    chance: [
      { id: "nucleo_eter", qty: [1, 1], p: 0.35, win: true, note: "há condensação garantida no ferreiro" },
      { id: "selo_forja", qty: [1, 1], p: 0.06, win: true, note: "há certificação garantida no ferreiro" },
    ],
  },
  "fight:boxe": {
    label: "Boxe", winLabel: "Vitórias do Boxe",
    sure: [{ id: "couro_reforcado", qty: { byMinutes: true, win: 1 } }],
    chance: [{ id: "rebite", qty: [1, 1], p: 0.35, win: true, note: "também pode ser produzido no ferreiro" }],
  },
  "minigame:paint": { label: "Paint", sure: [{ id: "pigmento_eter", qty: { byMinutes: true, win: 1 } }] },
  "minigame:gincana": { label: "Gincana", sure: [{ id: "mola_precisao", qty: { byMinutes: true, win: 1 } }] },
  "minigame:jetpack": { label: "Jetpack", sure: [{ id: "injetor_vapor", qty: { byMinutes: true, win: 1 } }] },
  "minigame:corrida": { label: "Antigravidade", sure: [{ id: "capacitor", qty: { byMinutes: true, win: 1 } }] },
  "minigame:noturno": { label: "Rolê Noturno", sure: [{ id: "rolamento", qty: { byMinutes: true, win: 1 } }] },
});

/** Atividade (Adv.ACTIVITIES) → tabela. Luta: Lâminas/rua/Domínio = laminas; Boxe = boxe. */
const ACTIVITY_TABLE = Object.freeze({
  laminas: "fight:laminas",
  boxe: "fight:boxe",
  paint: "minigame:paint",
  gincana: "minigame:gincana",
  jetpack: "minigame:jetpack",
  corrida: "minigame:corrida",
  noturno: "minigame:noturno",
});

/**
 * Família de antes (meuMundoGear.LOOT, ainda exportada pela fachada) → material comum, incomum e
 * raro. Mantida igual para quem lê `Gear.LOOT`; a regra é a das tabelas acima.
 */
const LOOT = Object.freeze({
  forja: { base: "fragmento_lamina", uncommon: "nucleo_eter", rare: "selo_forja" },
  couro: { base: "couro_reforcado", uncommon: "rebite", rare: null },
  pigmento: { base: "pigmento_eter", uncommon: null, rare: null },
  mola: { base: "mola_precisao", uncommon: null, rare: null },
  vapor: { base: "injetor_vapor", uncommon: null, rare: null },
  capacitor: { base: "capacitor", uncommon: null, rare: null },
  rolamento: { base: "rolamento", uncommon: null, rare: null },
});
/** Família de antes → tabela (para `Gear.rollLoot(family, …)`, que segue existindo). */
const FAMILY_TABLE = Object.freeze({
  forja: "fight:laminas",
  couro: "fight:boxe",
  pigmento: "minigame:paint",
  mola: "minigame:gincana",
  vapor: "minigame:jetpack",
  capacitor: "minigame:corrida",
  rolamento: "minigame:noturno",
});

module.exports = { TABLES, ACTIVITY_TABLE, LOOT, FAMILY_TABLE };
