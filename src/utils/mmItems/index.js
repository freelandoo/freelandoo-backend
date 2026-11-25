// src/utils/mmItems/index.js — trilha E, fatia E1: CATÁLOGO DE ITENS em dados.
//
// Monta o catálogo a partir de catalog/*, valida (validate.js) e exporta. Regra pura, sem banco.
// meuMundoGear.js e meuMundoForge.js são fachada deste módulo e de rules/* (mesmos exports de antes).
// A ORDEM de GEAR e RECIPES é a de antes da E1 (o `GET /gear` e o fixture dependem dela): itens novos
// entram no fim da lista da sua categoria nova.
// Plano: MEU MUNDO 3D/planos/2026-11-11-itens-equipamentos-e-progressao.md, §5.1 e §5.2.
"use strict";

const { CATEGORIES, RARITIES, validateCatalog } = require("./validate");
const Rank = require("./rules/rank");
const ClassStats = require("./rules/classStats");
const weapons = require("./catalog/weapons");
const weaponsTripo = require("./catalog/weaponsTripo");
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
const protections = require("./catalog/protections");
const { SETS, SET_STEPS } = setsCat;
const { KEYS_BY_ID } = require("./catalog/keys");
const Bonus = require("./rules/bonus");
const { LOOT, TABLES: LOOT_TABLES, ACTIVITY_TABLE, FAMILY_TABLE, domainTableId } = require("./catalog/loot");
const LootRule = require("./rules/loot");
const WeekPrize = require("./catalog/weekPrize");
const Exchange = require("./catalog/exchange");
const chests = require("./catalog/chests");
// weapon-v1 (24/11/2026): pós e fragmentos de classe; o que saiu do jogo (catalog/retired.js)
const weaponProgressCat = require("./catalog/weaponProgress");
const Retired = require("./catalog/retired");
const WeaponProgress = require("./rules/weaponProgress");

const PARTS = [weapons, weaponsTripo, armor, accessories, materials, blueprints, quest, cosmetics, relics, fragments, runes, consumables, currency, setsCat, lines, bestiary, chests, weaponProgressCat, protections];

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

const GEAR0 = Object.freeze([
  ...weapons.ITEMS, ...armor.ITEMS, ...accessories.ITEMS, ...materials.ITEMS,
  ...blueprints.ITEMS, ...quest.ITEMS, ...cosmetics.ITEMS, ...recipes.COMPONENT_ITEMS,
  ...relics.ITEMS, ...fragments.ITEMS, ...runes.ITEMS, ...consumables.ITEMS, ...currency.ITEMS,
  // E7: as 12 peças dos conjuntos entram no fim (a ordem de antes não muda)
  ...setsCat.ITEMS,
  // E8: armas de linha, fragmentos, materiais novos, fichas e projetos (no fim; a ordem de antes não muda)
  ...lines.ITEMS,
  // S14: amuletos dos Domínios, fragmentos de acessório/personagem/deus e embriões (no fim)
  ...bestiary.ITEMS,
  // E18: a receita oculta (fora do catálogo público até ser descoberta)
  ...chests.ITEMS,
  // 22/11/2026: armas novas do Tripo (cajados da Raposa, espadas, pesadas e as primeiras Divinas), no fim
  ...weaponsTripo.ITEMS,
  // weapon-v1 (24/11/2026): os 9 pós de refinamento e os 10 fragmentos de classe (no fim)
  ...weaponProgressCat.ITEMS,
  // 24/11/2026 (tudo por fragmento): as 52 proteções novas, os fragmentos de cada peça da Forja e os dos preparos (no fim)
  ...protections.ITEMS, ...consumables.FRAGMENT_ITEMS,
].map(withRule));

/**
 * Receitas que CONTINUAM (weapon-v1): Criogenia/bestiário e preparos. Peças, montagens, conversões,
 * equipamento direto, armas/conjuntos por fragmento específico e a receita oculta saíram (catalog/retired.js);
 * a arma agora se monta por fragmento de CLASSE (rules/weaponProgress.js, `assemble` no serviço).
 */
const ALL_RECIPES = Object.freeze([...recipes.PART_RECIPES, ...recipes.ASSEMBLIES, ...recipes.CONVERSIONS, ...recipes.ITEM_RECIPES, ...lines.FRAGMENT_RECIPES, ...bestiary.RECIPES, ...consumables.RECIPES, ...chests.RECIPES, ...protections.RECIPES]);
const RECIPES = Object.freeze(ALL_RECIPES.filter(Retired.keepRecipe));
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
  source.push(...WeekPrize.prizeSourceLines(item.id)); // legend-v1: 1º lugar da semana dos minijogos
  // E17: Loja de troca (fichas)
  for (const o of Exchange.OFFERS) if (o.gives[item.id]) source.push(`Loja de troca: ${o.gives[item.id]} por ${o.cost} fichas do ${Exchange.GAME_NAME[o.token.replace("ficha_", "")]}.`);
  for (const r of RECIPES) if (r.out === item.id) source.push(`Ferreiro: produzir ${item.name} (${r.coins} moedas e ingredientes da receita).`);
  // weapon-v1: toda arma se monta na Forja com fragmentos da classe dela (o jogador escolhe qual)
  const asm = WeaponProgress.assemblyCost(item);
  if (asm) source.push(`Forja: montar com ${asm.need} fragmentos de classe ${weaponProgressCat.rankName(asm.rank)}.`);
  return source;
}

/**
 * weapon-v1: item APOSENTADO = pilha da forja/refino antigos (catalog/retired.js) ou peça que ficou sem
 * nenhuma origem (conjuntos, proteções e acessórios que só saíam de receita). Continua no catálogo (cópias e
 * recibos antigos), marcado `retired`; a validação exige que nada aposentado ainda tenha origem.
 */
const GEAR = Object.freeze(GEAR0.map((g) => (Retired.isRetiredStack(g) || !sourcesOf(g).length ? Object.freeze({ ...g, retired: true }) : g)));
const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

const ERRORS = validateCatalog({ items: GEAR, recipes: RECIPES, loot: LOOT, sets: SETS, sources: sourcesOf });
if (ERRORS.length) throw new Error(`Catálogo do Meu Mundo inválido:\n- ${ERRORS.join("\n- ")}`);

module.exports = {
  CATEGORIES, RARITIES, RANKS: Rank.RANKS, RANK_ORDER: Rank.RANK_ORDER, rankOf: Rank.rankOf, CLASS_STATS: ClassStats,
  GEAR, GEAR_BY_ID, RECIPES, RECIPE_BY_ID, DESCRIPTIONS, SETS, SET_STEPS, LOOT,
  bonusOf: (pieces, opts = {}) => Bonus.bonusOf(pieces, { sets: SETS, steps: SET_STEPS, ...opts }), pieceBonus: Bonus.pieceBonus, LOOT_TABLES, ACTIVITY_TABLE, FAMILY_TABLE,
  rollTable, lootSourcesOf: LootRule.lootSourcesOf, lootExpectation: LootRule.expectation, domainTableId,
  FORGE: recipes, LINES: lines, PROTECTIONS: protections, EXCHANGE: Exchange, CHESTS: chests, WEAPON_PROGRESS: WeaponProgress, RETIRED: Retired,
  sourcesOf,
  validateCatalog: () => validateCatalog({ items: GEAR, recipes: RECIPES, loot: LOOT, sets: SETS, sources: sourcesOf }),
};
