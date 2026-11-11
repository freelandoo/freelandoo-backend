// src/utils/mmItems/catalog/cosmetics.js — trilha E, fatia E1: cosméticos.
// Movido de meuMundoGear.js sem mudar nenhum número, nome ou texto (prova: meuMundoItensCatalogo.test.js).
"use strict";

const { G } = require("./_base");

const ITEMS = Object.freeze([
  G("pintura_arma_eter", "cosmetic", "Pintura de arma: éter", "rare", { sell: 50 }),
  G("rastro_eter", "cosmetic", "Rastro de éter", "rare", { sell: 60 }),
  G("emote_saudacao", "cosmetic", "Emote: saudação de Lúmen", "uncommon", { sell: 30 }),
]);

const DESCRIPTIONS = Object.freeze({
  pintura_arma_eter: "Acabamento cosmético de éter para a arma, sem alterar atributos, alcance ou dano.",
  rastro_eter: "Rastro cosmético de éter para golpes, sem alterar a janela de acerto ou o alcance.",
  emote_saudacao: "Desbloqueia a saudação social de Lúmen, sem bônus de combate.",
});

module.exports = { ITEMS, DESCRIPTIONS };
