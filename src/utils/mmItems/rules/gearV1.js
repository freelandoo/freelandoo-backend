// src/utils/mmItems/rules/gearV1.js — trilha E, fatia E1: REGRA de equipamento em vigor (5 slots,
// bônus somado com teto, saque por família). Movida de meuMundoGear.js sem mudar número; a E4/E6/E7
// trocam pelo bonus v2 (rules/bonus.js) e pelos 8 slots.
"use strict";

const Items = require("../index");
const Forge = require("./forgeV1");

const { GEAR, GEAR_BY_ID, RECIPES, DESCRIPTIONS } = Items;

const SLOTS = Object.freeze(["weapon", "shield", "armor", "acc1", "acc2"]);

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
  if (["weapon", "armor"].includes(item.category)) uses.push("Refinar de +0 a +10 mediante proposta, com custo, pisos e proteção opcionais.");
  if (item.use === "learn_recipe") uses.push("Aprender uma vez; o projeto consumido fica registrado permanentemente.");
  if (item.use === "inspect_quest") uses.push("Examinar a inscrição e registrar a leitura na coleção; não conclui missão automaticamente.");
  if (item.use === "apply_weapon_cosmetic") uses.push("Ativar o visual cosmético da arma, sem bônus de combate.");
  if (item.use === "unlock_emote") uses.push("Desbloquear a saudação de Lúmen na coleção de emotes.");
  for (const r of consuming) uses.push(`Ingrediente de ${GEAR_BY_ID.get(r.out)?.name || r.out}: ${r.needs[item.id]} unidade(s).`);
  if (["fragmento_lamina", "couro_reforcado", "nucleo_eter", "selo_forja"].includes(item.id)) uses.push("Custo de refinamento ou proteção; a cotação informa a quantidade exata.");
  if (item.sell > 0) uses.push(`Reciclar por ${item.sell} moedas por unidade quando não estiver equipado.`);
  return { description: item.description || DESCRIPTIONS[item.id], source, uses, assemblyParts: assembly ? [...assembly.parts] : [] };
}

/** Qual arma de aprendiz é a da classe. */
const starterOf = (clan) => (clan === "raposa" ? "cajado_aprendiz" : clan === "vampiro" ? "espada_aprendiz" : null);

/** Slot onde um item entra (acessório escolhe 1 ou 2). */
function slotsFor(item) {
  if (!item) return [];
  if (item.category === "weapon") return ["weapon"];
  if (item.category === "shield") return ["shield"];
  if (item.category === "armor") return ["armor"];
  if (item.category === "accessory") return ["acc1", "acc2"];
  return [];
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
 * Bônus do que está equipado, SOMADO e com teto. `equipped` = { slot: { id, level } }.
 * O aprimoramento entra aqui (arma: dano; proteção: defesa).
 */
function gearBonus(equipped) {
  const sum = Object.fromEntries(Object.keys(GEAR_CAP).map((k) => [k, 0]));
  for (const slot of SLOTS) {
    const e = equipped && equipped[slot];
    const it = e && GEAR_BY_ID.get(e.id);
    if (!it || !it.bonus) continue;
    for (const [k, v] of Object.entries(it.bonus)) sum[k] += v || 0;
    const lv = Math.max(0, Math.min(UPGRADE.MAX, e.level || 0));
    if (it.category === "weapon") sum.dmg += lv * UPGRADE.DMG;
    if (it.category === "armor") sum.def += lv * UPGRADE.DEF;
    if (it.category === "weapon" || it.category === "armor") {
      const extra = Math.max(0, lv - 5);
      for (const [k, v] of Object.entries(UPGRADE.SECONDARY)) sum[k] += extra * v;
    }
  }
  for (const k of Object.keys(sum)) sum[k] = Math.round(Math.min(GEAR_CAP[k], sum[k]) * 10000) / 10000;
  return sum;
}

/** Custo do próximo aprimoramento (null = no máximo / não aprimora). */
function upgradeCost(item, level) {
  const q = Forge.quote(item, level);
  return q ? { ...q.cost, to: q.toMax } : null;
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

/** Catálogo público (o front traduz o nome por id; aqui vai o pt como reserva). */
function publicGear() {
  return {
    slots: SLOTS,
    cap: GEAR_CAP,
    upgrade: { max: UPGRADE.MAX, dmg: UPGRADE.DMG, def: UPGRADE.DEF, secondary: UPGRADE.SECONDARY, rulesVersion: Forge.RULES_VERSION },
    items: GEAR.map((g) => ({ id: g.id, shop: g.shop || null, category: g.category, name: g.name, rarity: g.rarity, tier: g.tier, price: g.price, level: g.level, clan: g.clan, bonus: g.bonus, family: g.family, stack: g.stack, sell: g.sell, component: g.component, use: g.use, action: g.action, cosmeticEffect: g.cosmeticEffect, lore: g.lore, ...itemDetails(g) })),
    recipes: RECIPES,
  };
}

module.exports = { SLOTS, GEAR_CAP, UPGRADE, STACK_MAX, starterOf, slotsFor, canEquip, gearBonus, upgradeCost, rollLoot, itemDetails, publicGear };
