// src/utils/mmItems/rules/gearV1.js — trilha E, fatia E1: REGRA de equipamento em vigor (5 slots,
// bônus somado com teto, saque por família). Movida de meuMundoGear.js sem mudar número; a E4/E6/E7
// trocam pelo bonus v2 (rules/bonus.js) e pelos 8 slots.
"use strict";

const Items = require("../index");
const Forge = require("./forgeV1");
const Upgrade = require("./upgrade");
const Salvage = require("./salvage");
const B = require("./budget");
const Runes = require("./runes");
const Ascend = require("./ascend");
const Enchant = require("./enchant");

const { GEAR, GEAR_BY_ID, RECIPES, DESCRIPTIONS } = Items;

/** Trilha E6 (A4): os 8 slots. Até a E5 eram weapon, shield, armor, acc1, acc2 (LEGACY_SLOTS). */
const SLOTS = Object.freeze(["weapon", "offhand", "helm", "chest", "gloves", "boots", "amulet", "relic"]);
/** Slot antigo → novo (acc1/acc2 vão para o slot da peça; sem peça, amulet). */
const LEGACY_SLOTS = Object.freeze({ shield: "offhand", armor: "chest", acc1: null, acc2: null });
const normalizeSlot = (slot, item) => (slot in LEGACY_SLOTS ? LEGACY_SLOTS[slot] || (item && item.slot) || "amulet" : slot);

/**
 * Teto dos bônus SOMADOS de tudo que está equipado (frações). Trilha E4 (A12): as 10 chaves do §6.3
 * (hp, acc, spd, int, dex novas), as mesmas do GEAR_MAX da luta (laminas/sim/fight.ts).
 */
const GEAR_CAP = Object.freeze({ dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18, hp: 0.25, acc: 0.2, spd: 0.15, int: 0.15, dex: 0.15 });
/** Preserve the old per-level bonuses; the expanded caps keep +6..10 useful. */
const UPGRADE = Object.freeze({ MAX: Forge.MAX_LEVEL, DMG: 0.02, DEF: 0.015, COINS: Forge.COINS, MATS: Forge.MATERIALS, SECONDARY: Forge.SECONDARY_PER_LEVEL });
/** E2: pilha até 9.999 (CHECK da mig 446). */
const STACK_MAX = 9999;

/** Metadata is derived from actual recipes so no source/usage becomes stale. */
function itemDetails(item) {
  const consuming = RECIPES.filter((r) => r.needs[item.id]);
  const assembly = Items.FORGE.ASSEMBLIES.find((r) => r.out === item.id);
  const source = Items.sourcesOf(item);
  const uses = [];
  if (item.use === "equip") uses.push("Equipar no slot compatível; bônus de aventura sujeitos ao teto.");
  // E9: aprimoramento garantido (forge-v2) em todo equipamento
  if (Upgrade.upgradable(item)) uses.push("Aprimorar de +0 a +15 com custo fixo, sempre subindo; do +11 em diante, depois da Ascensão.");
  if (Upgrade.upgradable(item)) uses.push("Desmontar na Forja: devolve parte dos materiais e Pó de Refino, nunca Esmeralda.");
  // E15: encanto
  if (Enchant.enchantable(item) && Enchant.pool(item).length) uses.push(`Encantar na Forja: troca a chave secundária por outra do slot (${10 * item.tier} Pó de Refino e ${item.tier} Cristal Bruto por sorteio de até 3 opções; recusar não muda nada).`);
  // E14: Ascensão e Despertar
  if (Ascend.ascendable(item)) uses.push(`Ascender no +${Ascend.ASCEND_AT} com ${2 * item.tier} Selo(s) de Domínio: libera o +11 ao +15 e um engaste a mais; depois, Despertar liga a passiva da peça.`);
  if (Salvage.transmutable(item)) uses.push("Transmutar na Forja: 3 viram 1 de outro material do mesmo tier.");
  if (item.use === "learn_recipe") uses.push("Aprender uma vez; o projeto consumido fica registrado permanentemente.");
  if (item.use === "inspect_quest") uses.push("Examinar a inscrição e registrar a leitura na coleção; não conclui missão automaticamente.");
  if (item.use === "apply_weapon_cosmetic") uses.push("Ativar o visual cosmético da arma, sem bônus de combate.");
  if (item.use === "unlock_emote") uses.push("Desbloquear a saudação de Lúmen na coleção de emotes.");
  if (Array.isArray(item.notes)) uses.push(...item.notes); // E8: uso declarado (custo de forja que não é receita)
  for (const r of consuming) uses.push(`Ingrediente de ${GEAR_BY_ID.get(r.out)?.name || r.out}: ${r.needs[item.id]} unidade(s).`);
  if (item.category === "fragment" && item.fragment) uses.push(`Converter o que sobrar em Pó de Refino: ${item.fragment.powder} por fragmento.`);
  if (item.sell > 0) uses.push(`Reciclar por ${item.sell} moedas por unidade quando não estiver equipado.`);
  return { description: item.description || DESCRIPTIONS[item.id], source, uses, assemblyParts: assembly ? [...assembly.parts] : [] };
}

/** Qual arma de aprendiz é a da classe. */
const starterOf = (clan) => (clan === "raposa" ? "cajado_aprendiz" : clan === "vampiro" ? "espada_aprendiz" : null);

/** Slot onde um item entra (E6: um só, o `slot` do catálogo). */
function slotsFor(item) {
  return item && item.slot && SLOTS.includes(item.slot) ? [item.slot] : [];
}

/** Pode equipar? (classe, nível, posse) — devolve o código do motivo ou null. */
function canEquip(item, { clan, level, owned }) {
  if (!item || !slotsFor(item).length) return "slot";
  if (!owned) return "owned";
  if (item.clan && item.clan !== clan) return "clan";
  if ((level || 1) < item.level) return "level";
  return null;
}

/**
 * Bônus do que está equipado, com teto. `equipped` = { slot: { id, level, grade } }.
 * Trilha E7: sai da RÉGUA (rules/bonus.js): cada peça soma budget.piece() nas duas chaves dela
 * (`level` = plus, `grade` = refinamento), depois o conjunto; subteto por fonte e teto por chave.
 * Até a E6 era o `bonus` escrito à mão + dano/defesa por nível de refino.
 * E6: aceita também as chaves de antes (shield/armor/acc1/acc2); duas peças no mesmo slot: vale a 1ª.
 */
function gearBonus(equipped) {
  const bySlot = {};
  for (const [k, e] of Object.entries(equipped || {})) {
    const it = e && GEAR_BY_ID.get(e.id);
    const s = normalizeSlot(k, it);
    if (SLOTS.includes(s) && !bySlot[s] && it && it.slot === s) bySlot[s] = { item: it, plus: Math.max(0, Math.floor(e.level || 0)), grade: Math.max(1, Math.floor(e.grade || 1)), sockets: Array.isArray(e.sockets) ? e.sockets.slice(0, Runes.MAX_SOCKETS) : [], awakened: !!e.awakened, enchant: e.enchant || null };
  }
  const { bonus } = Items.bonusOf(Object.values(bySlot));
  const out = {};
  for (const k of Object.keys(GEAR_CAP)) out[k] = Math.min(GEAR_CAP[k], bonus[k] || 0);
  return out;
}

/** Custo do próximo aprimoramento (null = no máximo / não aprimora). E9: o garantido (forge-v2). */
function upgradeCost(item, level) {
  const q = Upgrade.upgradeCost(item, level);
  return q ? { coins: q.coins, needs: q.needs, to: q.to } : null;
}

/**
 * Drop de uma atividade VALIDADA. Recompensa básica útil GARANTIDA (o material
 * comum da família); vitória aumenta a quantidade e abre as chances. Nunca
 * depende de sorte rara para a missão (missões pedem o material comum).
 * `R` = sorteio 0–1 (o servidor passa o seu).
 */
function rollLoot(family, { win, activeMs }, R) {
  // E3: a família de antes aponta a sua tabela nomeada (catalog/loot.js); mesma regra e ordem.
  const table = Items.FAMILY_TABLE[family];
  return table ? Items.rollTable(table, { win, activeMs }, R) : [];
}

/**
 * Catálogo público (o front traduz o nome por id; aqui vai o pt como reserva). E18: item `hidden`
 * (receita oculta) e a receita que pede ele só aparecem para quem já descobriu (`reveal(id)`).
 */
function publicGear({ reveal = () => false } = {}) {
  const shown = (g) => !g.hidden || reveal(g.id);
  return {
    slots: SLOTS,
    cap: GEAR_CAP,
    // E9: aprimoramento garantido +0…+15; do +11 em diante só ascendida
    upgrade: { max: Upgrade.MAX_PLUS, ascendFrom: B.ASCEND_FROM, stone: Upgrade.STONE, rulesVersion: Upgrade.RULES_VERSION },
    // E11: desmontar (35% da receita + Pó) e transmutar (3 → 1 do mesmo tier, + Esmeraldas × tier)
    salvage: { share: Salvage.SALVAGE_SHARE, confirmTier: Salvage.CONFIRM_TIER, transmuteIn: Salvage.TRANSMUTE_IN, transmuteCoins: Salvage.TRANSMUTE_COINS },
    // E14: Ascensão (no +10: 2 × tier Selos) e Despertar (ascendida: tier Essências + tier Selos)
    ascend: { at: Ascend.ASCEND_AT, seal: Ascend.SEAL, essence: Ascend.ESSENCE, sealPerTier: 2 },
    // E17: loja de troca (fichas → itens); `tokensPerMatch` = fichas de uma partida típica
    exchange: { offers: require("../catalog/exchange").OFFERS, tokensPerMatch: require("../catalog/exchange").TOKENS_PER_MATCH },
    // E16: preparo — um por luta, só nestas origens (Boxe, Hall, deus e prólogo recusam)
    prep: { origins: require("../catalog/consumables").PREP_ORIGINS, max: require("../catalog/consumables").PREP_VALUE },
    // E15: encanto — sorteio de até `options` chaves do slot, custo 10 × tier Pó + tier Cristal
    enchant: { options: Enchant.OPTIONS, powder: Enchant.POWDER, crystal: Enchant.CRYSTAL },
    // E13: runas — engastes por raridade (+1 ascendida, teto 3), fusão 3 → 1, valor de cada grau por chave
    runes: { sockets: Runes.SOCKETS, maxSockets: Runes.MAX_SOCKETS, fuseIn: Runes.FUSE_IN, grades: Runes.GRADES, kinds: Runes.RUNE_KINDS,
      value: Object.fromEntries(Object.values(Runes.RUNE_KINDS).map((k) => [k, Array.from({ length: Runes.GRADES }, (_, i) => Math.round(Runes.runeValue(k, i + 1) * 100000) / 100000)])) },
    items: GEAR.filter(shown).map((g) => ({ id: g.id, shop: g.shop || null, category: g.category, slot: g.slot || null, twoHanded: !!g.twoHanded, ...(g.keys ? { keys: g.keys } : {}), ...(g.set ? { set: g.set } : {}), ...(g.domain ? { domain: g.domain } : {}), ...(g.line ? { line: true } : {}), ...(g.fragment ? { fragment: g.fragment } : {}), ...(g.rune ? { rune: g.rune } : {}), ...(g.prep ? { prep: g.prep } : {}), ...(g.slot && g.tier ? { sockets: Runes.socketsOf(g) } : {}), ...(g.origin ? { origin: g.origin } : {}), ...(Salvage.transmutable(g) ? { transmutable: true } : {}), name: g.name, rarity: g.rarity, tier: g.tier, price: g.price, level: g.level, clan: g.clan, bonus: g.bonus, family: g.family, stack: g.stack, sell: g.sell, component: g.component, use: g.use, action: g.action, cosmeticEffect: g.cosmeticEffect, lore: g.lore, ...itemDetails(g) })),
    recipes: RECIPES.filter((r) => !r.hidden || reveal(r.recipe)),
    // E7: conjuntos (2 ou 3 peças = 40% da fatia, 4 = 100%)
    sets: Items.SETS.map((s) => ({ id: s.id, name: s.name, domain: s.domain, keys: s.keys, pieces: s.pieces, steps: Items.SET_STEPS })),
  };
}

module.exports = { SLOTS, LEGACY_SLOTS, normalizeSlot, GEAR_CAP, UPGRADE, STACK_MAX, starterOf, slotsFor, canEquip, gearBonus, upgradeCost, rollLoot, itemDetails, publicGear };
