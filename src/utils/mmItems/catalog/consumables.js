// src/utils/mmItems/catalog/consumables.js — trilha E, fatia E16: CONSUMÍVEIS DE PREPARO.
//
// A luta não tem botão de item e é re-simulada, então o consumível é de PREPARO: escolhido na tela de
// versus, gasto ao abrir a luta e gravado no ticket (`setup.prep`). Soma no máximo +5% (PREP_MAX da
// regra da luta) numa chave, DEPOIS do teto do equipamento; não entra no Poder. Um por luta. Vale na
// Arena, na rua e nos Domínios; Boxe, Hall, deus solto e prólogo recusam.
// Fabricados na Forja (kind "prep"): Madeira Ancestral + Pó de Forja + um material da região.
"use strict";

const { G } = require("./_base");

/** Valor do preparo (o teto da regra da luta, laminas/sim/fight.ts PREP_MAX). */
const PREP_VALUE = 0.05;
/** Lutas que aceitam preparo (origem do ticket). */
const PREP_ORIGINS = Object.freeze(["laminas", "mob", "domain"]);

const KEY_TEXT = Object.freeze({ dmg: "dano", def: "defesa", hp: "vida", acc: "acuracidade", spd: "velocidade", int: "inteligência", dex: "destreza", stam: "fôlego" });
const LIST = Object.freeze([
  { id: "oleo_lamina", name: "Óleo de Lâmina", key: "dmg", mat: "escoria", desc: "Óleo grosso do Vulcão: o fio da arma corta mais nesta luta." },
  { id: "verniz_couraca", name: "Verniz de Couraça", key: "def", mat: "engrenagem_fina", desc: "Verniz de bronze da Fábrica: a proteção amortece mais nesta luta." },
  { id: "tonico_vida", name: "Tônico de Vida", key: "hp", mat: "gelo_negro", desc: "Tônico gelado do Mar de Gelo: mais vida para esta luta." },
  { id: "colirio_mira", name: "Colírio de Mira", key: "acc", mat: "po_de_lua", desc: "Gotas de luar da Floresta: o olho acerta mais nesta luta." },
  { id: "graxa_botas", name: "Graxa de Botas", key: "spd", mat: "areia_de_raio", desc: "Graxa com areia de raio do Cânion: passos mais rápidos nesta luta." },
  { id: "cha_engrenagem", name: "Chá de Engrenagem", key: "int", mat: "vidro_colorido", desc: "Chá de vidro moído da Cidade Orbital: a cabeça pensa mais rápido nesta luta." },
  { id: "po_garra", name: "Pó de Garra", key: "dex", mat: "couro_reforcado", desc: "Pó de couro curtido do ringue: mãos mais hábeis nesta luta." },
  { id: "vapor_folego", name: "Vapor de Fôlego", key: "stam", mat: "injetor_vapor", desc: "Vapor engarrafado do Jetpack: o fôlego rende mais nesta luta." },
]);

const ITEMS = Object.freeze(LIST.map((c) => G(c.id, "consumable", c.name, "uncommon", {
  stack: true, sell: 0, use: null, action: null,
  prep: Object.freeze({ key: c.key, v: PREP_VALUE }),
  notes: Object.freeze([
    `Preparo: escolha na tela de versus, antes de lutar. +${Math.round(PREP_VALUE * 100)}% de ${KEY_TEXT[c.key]} nesta luta, por cima do teto do equipamento.`,
    "Um por luta, gasto ao escolher. Vale na Arena, na rua e nos Domínios; não vale no Boxe, no Hall nem contra o deus solto.",
  ]),
})));

const RECIPES = Object.freeze(LIST.map((c) => Object.freeze({
  id: `preparar_${c.id}`, kind: "prep", out: c.id, qty: 1,
  needs: Object.freeze({ madeira_ancestral: 1, po_forja: 2, [c.mat]: 3 }),
  coins: 40, level: 1, recipe: null,
})));

const DESCRIPTIONS = Object.freeze(Object.fromEntries(LIST.map((c) => [c.id, c.desc])));

module.exports = { ITEMS, RECIPES, DESCRIPTIONS, PREP_VALUE, PREP_ORIGINS };
