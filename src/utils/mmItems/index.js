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
const setsCat = require("./catalog/sets");
const lines = require("./catalog/lines");
const bestiary = require("./catalog/bestiary");
const { SETS, SET_STEPS } = setsCat;
const { KEYS_BY_ID } = require("./catalog/keys");
const Bonus = require("./rules/bonus");
const { LOOT, TABLES: LOOT_TABLES, ACTIVITY_TABLE, FAMILY_TABLE, domainTableId } = require("./catalog/loot");
const LootRule = require("./rules/loot");
const Exchange = require("./catalog/exchange");

const PARTS = [weapons, armor, accessories, materials, blueprints, quest, cosmetics, relics, fragments, runes, consumables, currency, setsCat, lines, bestiary];

/**
 * E7: equipamento ganha as duas chaves (catalog/keys.js; as peças de conjunto trazem as suas) e o
 * `bonus` deixa de ser escrito à mão — é o da régua na cópia +0 grau I (o cartão mostra isso).
 */
function withRule(it) {
  if (!it.slot) return it;
  const keys = it.keys || KEYS_BY_ID[it.id] || null;
  if (!keys) return it;
  const ruled = { ...it, keys: Object.freeze([...keys]) };
  return Object.freeze({ ...ruled, bonus: Object.freeze(Bonus.pieceBonus(ruled, 0, 1)) });
}

const GEAR = Object.freeze([
  ...weapons.ITEMS, ...armor.ITEMS, ...accessories.ITEMS, ...materials.ITEMS,
  ...blueprints.ITEMS, ...quest.ITEMS, ...cosmetics.ITEMS, ...recipes.COMPONENT_ITEMS,
  ...relics.ITEMS, ...fragments.ITEMS, ...runes.ITEMS, ...consumables.ITEMS, ...currency.ITEMS,
  // E7: as 12 peças dos conjuntos entram no fim (a ordem de antes não muda)
  ...setsCat.ITEMS,
  // E8: armas de linha, fragmentos, materiais novos, fichas e projetos (no fim; a ordem de antes não muda)
  ...lines.ITEMS,
  // S14: amuletos dos Domínios, fragmentos de acessório/personagem/deus e embriões (no fim)
  ...bestiary.ITEMS,
].map(withRule));
const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

/** Toda peça, montagem, conversão e receita direta (ordem pública de antes). */
const RECIPES = Object.freeze([...recipes.PART_RECIPES, ...recipes.ASSEMBLIES, ...recipes.CONVERSIONS, ...recipes.ITEM_RECIPES, ...lines.FRAGMENT_RECIPES, ...bestiary.RECIPES, ...consumables.RECIPES]); // E16: preparo no fim (a ordem de antes não muda)
const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/** Descrição por id (a das peças da forja mora no próprio item). */
const DESCRIPTIONS = Object.freeze(Object.assign({}, ...PARTS.map((p) => p.DESCRIPTIONS)));

/** E3: sorteio de uma tabela nomeada (regra pura). */
const rollTable = (tableId, ctx, R) => LootRule.rollTable(tableId, ctx || {}, R, (id) => GEAR_BY_ID.get(id)?.rarity || "common");

/** "Onde conseguir": loja, prólogo, saque e ferreiro — derivado das receitas reais. */
function sourcesOf(item) {
  const source = [];
  if (item.starter) source.push("Prólogo: arma inicial gratuita da classe.");
  if (Array.isArray(item.source)) source.push(...item.source); // origem declarada (ex.: conjunto antes da E12)
  if (item.price != null) source.push(`${item.shop ? "Loja de Armas do Arsenal" : "Loja de equipamentos"}: ${item.price} moedas.`);
  source.push(...LootRule.lootSourceLines(item.id)); // E3: derivado das tabelas
  // E17: Loja de troca (fichas)
  for (const o of Exchange.OFFERS) if (o.gives[item.id]) source.push(`Loja de troca: ${o.gives[item.id]} por ${o.cost} fichas do ${Exchange.GAME_NAME[o.token.replace("ficha_", "")]}.`);
  // E13: runa de grau II em diante sai da fusão de 3 do grau abaixo
  if (item.rune && item.rune.grade > 1) source.push(`Fusão de runas: 3 runas de ${runes.KIND_NAME[item.rune.kind]} grau ${runes.ROMAN[item.rune.grade - 2]} viram 1 de grau ${runes.ROMAN[item.rune.grade - 1]}.`);
  for (const r of RECIPES) if (r.out === item.id) source.push(`Ferreiro: ${r.kind === "assembly" ? "montar" : r.kind === "part" ? "fabricar uma peça de" : "produzir"} ${item.name} (${r.coins} moedas e ingredientes da receita).`);
  return source;
}

const ERRORS = validateCatalog({ items: GEAR, recipes: RECIPES, loot: LOOT, sets: SETS, sources: sourcesOf });
if (ERRORS.length) throw new Error(`Catálogo do Meu Mundo inválido:\n- ${ERRORS.join("\n- ")}`);

module.exports = {
  CATEGORIES, RARITIES,
  GEAR, GEAR_BY_ID, RECIPES, RECIPE_BY_ID, DESCRIPTIONS, SETS, SET_STEPS, LOOT,
  bonusOf: (pieces) => Bonus.bonusOf(pieces, { sets: SETS, steps: SET_STEPS }), pieceBonus: Bonus.pieceBonus, LOOT_TABLES, ACTIVITY_TABLE, FAMILY_TABLE,
  rollTable, lootSourcesOf: LootRule.lootSourcesOf, lootExpectation: LootRule.expectation, domainTableId,
  FORGE: recipes, LINES: lines, EXCHANGE: Exchange,
  sourcesOf,
  validateCatalog: () => validateCatalog({ items: GEAR, recipes: RECIPES, loot: LOOT, sets: SETS, sources: sourcesOf }),
};
