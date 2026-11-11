// src/utils/mmItems/catalog/quest.js — trilha E, fatia E1: itens de missão (recordações da coleção).
// Movido de meuMundoGear.js sem mudar nenhum número, nome ou texto (prova: meuMundoItensCatalogo.test.js).
"use strict";

const { G } = require("./_base");

const ITEMS = Object.freeze([
  G("cristal_morkhan", "quest", "Cristal rachado de Morkhan", "epic", { sell: 20 }),
  G("chave_subestacao", "quest", "Chave da subestação", "rare", { sell: 15 }),
  G("diario_sem_nome", "quest", "Diário do Sem-Nome", "rare", { sell: 20 }),
]);

const DESCRIPTIONS = Object.freeze({
  cristal_morkhan: "Recordação de Lúmen com uma inscrição sobre Morkhan; pode ser examinada na coleção.",
  chave_subestacao: "Recordação da subestação. Examine sua inscrição para registrar a descoberta na coleção.",
  diario_sem_nome: "Registro investigável sobre Aurion, os Sete e o Sem-Nome; integra a coleção de descobertas.",
});

module.exports = { ITEMS, DESCRIPTIONS };
