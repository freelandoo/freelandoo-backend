// src/utils/mmItems/catalog/accessories.js — trilha E, fatia E1: acessórios.
// Movido de meuMundoGear.js sem mudar nenhum número, nome ou texto (prova: meuMundoItensCatalogo.test.js).
"use strict";

const { G } = require("./_base");

const ITEMS = Object.freeze([
  G("relogio_bolso", "accessory", "Relógio de bolso", "common", { price: 300, bonus: { warn: 0.05 }, sell: 40 }),
  G("luvas_precisao", "accessory", "Luvas de precisão", "uncommon", { price: 420, level: 2, bonus: { stam: 0.05 }, sell: 60 }),
  G("amuleto_aurion", "accessory", "Amuleto de Aurion", "rare", { bonus: { power: 0.1 }, sell: 0 }),
  G("botas_explorador", "accessory", "Botas do explorador", "uncommon", { price: 650, level: 2, bonus: { stam: 0.03, def: 0.02 }, sell: 80 }),
  G("oculos_engenheiro", "accessory", "Óculos do engenheiro", "uncommon", { price: 700, level: 2, bonus: { warn: 0.06 }, sell: 85 }),
  G("bracelete_isolante", "accessory", "Bracelete isolante", "rare", { price: 1000, level: 3, bonus: { def: 0.04 }, sell: 120 }),
  G("medalhao_lunar", "accessory", "Medalhão lunar", "rare", { level: 3, bonus: { stam: 0.03, power: 0.04 }, sell: 100 }),
  G("nucleo_equilibrio", "accessory", "Núcleo de equilíbrio", "rare", { level: 3, bonus: { warn: 0.03, def: 0.03 }, sell: 100 }),
]);

const DESCRIPTIONS = Object.freeze({
  relogio_bolso: "Acessório que amplia o aviso dos ataques inimigos nas lutas de aventura.",
  luvas_precisao: "Acessório que melhora a eficiência de fôlego nas lutas de aventura.",
  amuleto_aurion: "Acessório de Aurion que melhora o poder especial, dentro do teto de equipamento.",
  botas_explorador: "Acessório que combina eficiência de fôlego e defesa. Não aumenta a velocidade de corrida.",
  oculos_engenheiro: "Acessório de precisão que amplia o aviso de ataques; não fornece mira automática.",
  bracelete_isolante: "Acessório defensivo. A proteção se soma aos outros equipamentos dentro do teto.",
  medalhao_lunar: "Acessório que combina eficiência de fôlego e poder especial nas lutas de aventura.",
  nucleo_equilibrio: "Acessório que combina defesa e aviso de ataques. Não é a matéria-prima Núcleo de éter.",
});

module.exports = { ITEMS, DESCRIPTIONS };
