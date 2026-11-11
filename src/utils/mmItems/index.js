// src/utils/mmItems/index.js — trilha E, fatia E1: CATÁLOGO DE ITENS em dados.
//
// Monta o catálogo a partir de catalog/*, valida (validate.js) e exporta. Regra pura, sem banco.
// meuMundoGear.js e meuMundoForge.js são fachada deste módulo e de rules/* (mesmos exports de antes).
// A ORDEM de GEAR e RECIPES é a de antes da E1 (o `GET /gear` e o fixture dependem dela): itens novos
// entram no fim da lista da sua categoria nova.
// Plano: MEU MUNDO 3D/planos/2026-11-11-itens-equipamentos-e-progressao.md, §5.1 e §5.2.
"use strict";

const { CATEGORIES, RARITIES, validateCatalog } = require("./validate");
const weapons = require("./catalog/weapons");
const armor = require("./catalog/armor");
const accessories = require("./catalog/accessories");
const materials = require("./catalog/materials");
const blueprints = require("./catalog/blueprints");
const quest = require("./catalog/quest");
const cosmetics = require("./catalog/cosmetics");
const relics = require("./catalog/relics");
const fragments = require("./catalog/fragments");
const runes = require("./catalog/runes");
const consumables = require("./catalog/consumables");
const currency = require("./catalog/currency");
const recipes = require("./catalog/recipes");
const { SETS } = require("./catalog/sets");
const { LOOT, LOOT_SOURCE } = require("./catalog/loot");

const PARTS = [weapons, armor, accessories, materials, blueprints, quest, cosmetics, relics, fragments, runes, consumables, currency];

const GEAR = Object.freeze([
  ...weapons.ITEMS, ...armor.ITEMS, ...accessories.ITEMS, ...materials.ITEMS,
  ...blueprints.ITEMS, ...quest.ITEMS, ...cosmetics.ITEMS, ...recipes.COMPONENT_ITEMS,
  ...relics.ITEMS, ...fragments.ITEMS, ...runes.ITEMS, ...consumables.ITEMS, ...currency.ITEMS,
]);
const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

/** Toda peça, montagem, conversão e receita direta (ordem pública de antes). */
const RECIPES = Object.freeze([...recipes.PART_RECIPES, ...recipes.ASSEMBLIES, ...recipes.CONVERSIONS, ...recipes.ITEM_RECIPES]);
const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/** Descrição por id (a das peças da forja mora no próprio item). */
const DESCRIPTIONS = Object.freeze(Object.assign({}, ...PARTS.map((p) => p.DESCRIPTIONS)));

/** Tabelas de saque (E1: as 7 famílias de hoje; a E3 nomeia por fonte). */
const LOOT_TABLES = LOOT;

/** "Onde conseguir": loja, prólogo, saque e ferreiro — derivado das receitas reais. */
function sourcesOf(item) {
  const source = [];
  if (item.starter) source.push("Prólogo: arma inicial gratuita da classe.");
  if (item.price != null) source.push(`${item.shop ? "Loja de Armas do Arsenal" : "Loja de equipamentos"}: ${item.price} moedas.`);
  if (LOOT_SOURCE[item.id]) source.push(LOOT_SOURCE[item.id]);
  for (const r of RECIPES) if (r.out === item.id) source.push(`Ferreiro: ${r.kind === "assembly" ? "montar" : r.kind === "part" ? "fabricar uma peça de" : "produzir"} ${item.name} (${r.coins} moedas e ingredientes da receita).`);
  return source;
}

const ERRORS = validateCatalog({ items: GEAR, recipes: RECIPES, loot: LOOT, sets: SETS, sources: sourcesOf });
if (ERRORS.length) throw new Error(`Catálogo do Meu Mundo inválido:\n- ${ERRORS.join("\n- ")}`);

module.exports = {
  CATEGORIES, RARITIES,
  GEAR, GEAR_BY_ID, RECIPES, RECIPE_BY_ID, DESCRIPTIONS, SETS, LOOT, LOOT_SOURCE, LOOT_TABLES,
  FORGE: recipes,
  sourcesOf,
  validateCatalog: () => validateCatalog({ items: GEAR, recipes: RECIPES, loot: LOOT, sets: SETS, sources: sourcesOf }),
};
