// src/utils/mmItems/catalog/blueprints.js — trilha E, fatia E1: projetos e receitas (itens de categoria recipe).
// Movido de meuMundoGear.js sem mudar nenhum número, nome ou texto (prova: meuMundoItensCatalogo.test.js).
"use strict";

const { G } = require("./_base");

const ITEMS = Object.freeze([
  G("receita_eter", "recipe", "Receita: armas de éter", "rare", { sell: 0 }),
  G("receita_latao", "recipe", "Projeto: armas de latão", "uncommon", { sell: 0 }),
  G("receita_colete", "recipe", "Projeto: colete de couro", "uncommon", { sell: 0 }),
]);

const DESCRIPTIONS = Object.freeze({
  receita_latao: "Projeto que, aprendido, habilita as duas montagens de armas de latão. Cada arma continua exclusiva de sua classe.",
  receita_eter: "Projeto que, aprendido, habilita as quatro montagens de armas de éter e solares.",
  receita_colete: "Projeto que, aprendido, habilita fabricar o colete de couro na forja.",
});

module.exports = { ITEMS, DESCRIPTIONS };
