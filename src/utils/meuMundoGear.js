// src/utils/meuMundoGear.js — MEU MUNDO 3D mm3d-59: EQUIPAMENTO, MATERIAIS, RECEITAS, ITENS DE MISSÃO.
//
// Desde a trilha E, fatia E1, este arquivo é só FACHADA (mesmos exports de antes):
//  • os itens, descrições, receitas e o saque moram em `mmItems/catalog/*` (montados e validados em
//    `mmItems/index.js`);
//  • a regra em vigor (5 slots, bônus somado com teto, saque por família, catálogo público) mora em
//    `mmItems/rules/gearV1.js`.
// Item novo = arquivo de catalog/. Prova de que nada mudou: test/unit/meuMundoItensCatalogo.test.js.
//
// Princípios (pedido do Alex, valem para o catálogo inteiro):
//  • Classe mecânica, arma equipada e aparência são INDEPENDENTES; os golpes vêm do PERSONAGEM (skin
//    vestida), nunca da arma (mm3d-66). A arma muda só o modelo na mão e o bônus.
//  • Bônus de equipamento têm TETO somado. Moeda: as moedas do jogo (tb_mm_wallet), sem carteira nova.
"use strict";

const Items = require("./mmItems");
const Rules = require("./mmItems/rules/gearV1");

module.exports = {
  SLOTS: Rules.SLOTS,
  CATEGORIES: Items.CATEGORIES,
  RARITIES: Items.RARITIES,
  GEAR_CAP: Rules.GEAR_CAP,
  UPGRADE: Rules.UPGRADE,
  STACK_MAX: Rules.STACK_MAX,
  GEAR: Items.GEAR,
  GEAR_BY_ID: Items.GEAR_BY_ID,
  LOOT: Items.LOOT,
  RECIPES: Items.RECIPES,
  RECIPE_BY_ID: Items.RECIPE_BY_ID,
  starterOf: Rules.starterOf,
  slotsFor: Rules.slotsFor,
  canEquip: Rules.canEquip,
  gearBonus: Rules.gearBonus,
  upgradeCost: Rules.upgradeCost,
  rollLoot: Rules.rollLoot,
  itemDetails: Rules.itemDetails,
  publicGear: Rules.publicGear,
};
