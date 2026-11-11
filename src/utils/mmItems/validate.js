// src/utils/mmItems/validate.js — trilha E, fatia E1: VALIDAÇÃO do catálogo.
//
// validateCatalog() devolve a lista de erros (vazia = catálogo bom). index.js chama no carregamento e
// para o processo se houver erro: catálogo quebrado não pode chegar ao boot do servidor em silêncio.
// Regras (§5.1 do plano): id único; categoria, raridade e tier conhecidos; receita aponta item que
// existe; fragmento tem alvo; todo item tem origem; conjunto tem 4 peças; peça com `keys` tem as
// duas chaves permitidas no slot (a régua só é aplicada na E7 — itens de hoje não têm `keys`).
"use strict";

const budget = require("./rules/budget");

const CATEGORIES = Object.freeze([
  "weapon", "shield", "armor", "accessory", "material", "recipe", "quest", "cosmetic",
  // E1: categorias novas do §5.2 (aceitas já; os itens chegam nas fatias seguintes)
  "offhand", "relic", "fragment", "rune", "consumable", "currency",
]);
const RARITIES = Object.freeze(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);

/** @returns {string[]} erros encontrados */
function validateCatalog({ items, recipes = [], loot = {}, sets = [], sources = () => [] }) {
  const errors = [];
  const byId = new Map();
  for (const it of items) {
    if (!it || typeof it.id !== "string" || !it.id) { errors.push(`item sem id: ${JSON.stringify(it)}`); continue; }
    if (byId.has(it.id)) errors.push(`id repetido: ${it.id}`);
    byId.set(it.id, it);
    if (!CATEGORIES.includes(it.category)) errors.push(`${it.id}: categoria desconhecida ${it.category}`);
    if (!RARITIES.includes(it.rarity)) errors.push(`${it.id}: raridade desconhecida ${it.rarity}`);
    if (it.tier !== budget.TIER[it.rarity]) errors.push(`${it.id}: tier ${it.tier} não bate com ${it.rarity}`);
    if (typeof it.name !== "string" || !it.name) errors.push(`${it.id}: sem nome`);
    if (it.category === "fragment" && !(it.fragment && it.fragment.of && it.fragment.need > 0)) errors.push(`${it.id}: fragmento sem alvo`);
    if (it.keys != null) {
      const ok = budget.slotKeys(it.slot);
      if (!Array.isArray(it.keys) || it.keys.length !== 2 || new Set(it.keys).size !== 2 || !it.keys.every((k) => ok.includes(k))) errors.push(`${it.id}: keys ${JSON.stringify(it.keys)} não são duas chaves do slot ${it.slot}`);
    }
  }
  for (const it of items) if (it && it.category === "fragment" && it.fragment && !byId.has(it.fragment.of)) errors.push(`${it.id}: fragmento aponta ${it.fragment.of}, que não existe`);
  const recipeIds = new Set();
  for (const r of recipes) {
    if (recipeIds.has(r.id)) errors.push(`receita repetida: ${r.id}`);
    recipeIds.add(r.id);
    if (!byId.has(r.out)) errors.push(`receita ${r.id}: saída ${r.out} não existe`);
    for (const id of Object.keys(r.needs || {})) if (!byId.has(id)) errors.push(`receita ${r.id}: ingrediente ${id} não existe`);
    if (r.recipe && !byId.has(r.recipe)) errors.push(`receita ${r.id}: projeto ${r.recipe} não existe`);
  }
  for (const [family, t] of Object.entries(loot)) for (const id of [t.base, t.uncommon, t.rare]) if (id && !byId.has(id)) errors.push(`saque ${family}: ${id} não existe`);
  for (const s of sets) {
    if (!Array.isArray(s.pieces) || s.pieces.length !== 4) errors.push(`conjunto ${s.id}: precisa de 4 peças`);
    else for (const id of s.pieces) if (!byId.has(id)) errors.push(`conjunto ${s.id}: peça ${id} não existe`);
  }
  for (const it of items) if (it && it.id && !(sources(it) || []).length) errors.push(`${it.id}: sem origem`);
  return errors;
}

module.exports = { CATEGORIES, RARITIES, validateCatalog };
