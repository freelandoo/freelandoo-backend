// src/utils/mmItems/catalog/armor.js — trilha E, fatia E1: proteção.
// Movido de meuMundoGear.js sem mudar nenhum número, nome ou texto (prova: meuMundoItensCatalogo.test.js).
"use strict";

const { G } = require("./_base");

const ITEMS = Object.freeze([
  G("colete_couro", "armor", "Colete de couro", "common", { price: 250, bonus: { def: 0.05 }, sell: 35 }),
  G("couraca_rebitada", "armor", "Couraça rebitada", "uncommon", { price: 700, level: 3, bonus: { def: 0.08 }, sell: 100 }),
]);

const DESCRIPTIONS = Object.freeze({
  colete_couro: "Proteção de couro com defesa adicional; ocupa o slot de proteção.",
  couraca_rebitada: "Proteção reforçada com rebites; pode ser refinada e preserva seu aprimoramento anterior.",
});

module.exports = { ITEMS, DESCRIPTIONS };
