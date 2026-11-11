// src/utils/mmItems/catalog/_base.js — trilha E, fatia E1: construtores de item do catálogo.
//
// Saíram de meuMundoGear.js SEM mudar nenhum campo. Novidade da E1: `tier` (1…6 pela raridade,
// régua do §5.2 do plano 2026-11-11-itens-equipamentos-e-progressao.md).
"use strict";

const { TIER } = require("../rules/budget");

const LORE = Object.freeze({
  cristal_morkhan: "Uma luz violeta atravessa a rachadura. As marcas lembram o nome apagado de Morkhan, o oitavo campeão dos Jogos Eternos de Lúmen. Esta recordação pode ser examinada sem avançar uma missão.",
  diario_sem_nome: "As páginas reconstituídas mencionam Aurion, os Sete e um oitavo lugar vazio. Ainda não provam onde está Morkhan. Ler o diário registra a descoberta na coleção.",
  chave_subestacao: "Uma chave antiga marcada com uma engrenagem e o número oito. A origem da subestação continua desconhecida. Examinar a inscrição registra a descoberta na coleção.",
});
const cosmeticEffect = (id) => ({ pintura_arma_eter: "ether_paint", rastro_eter: "ether_trail", emote_saudacao: "lumen_salute" })[id] || null;
const useFor = (category, id) => category === "recipe" ? "learn_recipe" : category === "quest" ? "inspect_quest" : category === "cosmetic" ? (id === "emote_saudacao" ? "unlock_emote" : "apply_weapon_cosmetic") : ["weapon", "shield", "armor", "accessory"].includes(category) ? "equip" : null;

// id, categoria, nome (pt; o front traduz por `gear.<id>`), raridade, campos extras.
//  price: no Armeiro (null = não vende) · level: nível de aventura mínimo
//  clan: só essa classe usa · bonus: { dmg, def, stam, warn, power } (frações)
//  family: de onde o material cai · sell: moedas na reciclagem
const G = (id, category, name, rarity, o = {}) => Object.freeze({
  id, category, name, rarity, price: null, level: 1, clan: null, bonus: null,
  family: null, sell: 0, stack: category === "material" || category === "quest", component: false,
  use: useFor(category, id), action: useFor(category, id), cosmeticEffect: cosmeticEffect(id), lore: LORE[id] || null, ...o,
  tier: TIER[rarity] || null,
});

/** Espada da loja: de guerreiro (classe vampiro), recicla por ~12% do preço. */
const S = (id, name, rarity, level, price, bonus) => G(id, "weapon", name, rarity, { clan: "vampiro", level, price, bonus, sell: Math.round(price * 0.12), shop: "weapons" });
/** Arma pesada da aba Hammers: sem classe, quem decide é a skin vestida. */
const H = (id, name, rarity, level, price, bonus) => G(id, "weapon", name, rarity, { level, price, bonus, sell: Math.round(price * 0.12), shop: "hammers" });
/** Arco da aba Arcos (mm3d-69): sem classe, quem decide é a skin vestida. */
const B = (id, name, rarity, level, price, bonus) => G(id, "weapon", name, rarity, { level, price, bonus, sell: Math.round(price * 0.12), shop: "bows" });
/** Arma de fogo da aba Guns (mm3d-70): sem classe, quem decide é a skin vestida. */
const F = (id, name, rarity, level, price, bonus) => G(id, "weapon", name, rarity, { level, price, bonus, sell: Math.round(price * 0.12), shop: "guns" });
/** Escudo da loja (mm3d-68): de quem usa espada; quem decide é a skin vestida. */
const E = (id, name, rarity, level, price, bonus) => G(id, "shield", name, rarity, { level, price, bonus, sell: Math.round(price * 0.12), shop: "shields" });

module.exports = { G, S, H, B, F, E, LORE };
