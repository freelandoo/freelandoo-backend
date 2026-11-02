// src/utils/meuMundoGear.js — MEU MUNDO 3D mm3d-59 (slice 3): EQUIPAMENTO,
// MATERIAIS, RECEITAS, ITENS DE MISSÃO e a FORJA.
//
// Regra pura (sem banco). Os 30 consumíveis continuam em meuMundoLife.js
// (ITEMS) e a geladeira não muda; skins seguem em meuMundoSkins.js. Aqui mora
// o inventário NOVO (tb_mm_gear, mig 321).
//
// Princípios (pedido do Alex):
//  • Classe mecânica, arma equipada e aparência são INDEPENDENTES: a classe
//    decide o kit (raposa = maga com cajado, vampiro = lâmina com espada); a
//    arma só soma bônus pequenos e PRECISA ser da classe; sexo/fase/skin
//    nunca mudam kit, atributos ou habilidades.
//  • Bônus de equipamento têm TETO somado (não se multiplicam sem limite).
//  • Moeda: as moedas do jogo (tb_mm_wallet) — sem carteira nova.
"use strict";

const SLOTS = Object.freeze(["weapon", "armor", "acc1", "acc2"]);
const CATEGORIES = Object.freeze(["weapon", "armor", "accessory", "material", "recipe", "quest", "cosmetic"]);
const RARITIES = Object.freeze(["common", "uncommon", "rare", "epic", "legendary"]);

/** Teto dos bônus SOMADOS de tudo que está equipado (frações). */
const GEAR_CAP = Object.freeze({ dmg: 0.18, def: 0.12, stam: 0.08, warn: 0.08, power: 0.12 });
/** Aprimoramento da forja: +2% de dano (arma) ou +1,5% de defesa (proteção) por nível, até 5. */
const UPGRADE = Object.freeze({ MAX: 5, DMG: 0.02, DEF: 0.015, COINS: [120, 220, 380, 600, 900], MATS: [2, 3, 4, 6, 8] });
const STACK_MAX = 999;

// id, categoria, nome (pt; o front traduz por `gear.<id>`), raridade, campos extras.
//  price: no Armeiro (null = não vende) · level: nível de aventura mínimo
//  clan: só essa classe usa · bonus: { dmg, def, stam, warn, power } (frações)
//  family: de onde o material cai · sell: moedas na reciclagem
const G = (id, category, name, rarity, o = {}) =>
  Object.freeze({ id, category, name, rarity, price: null, level: 1, clan: null, bonus: null, family: null, sell: 0, stack: category === "material" || category === "quest", ...o });

const GEAR = Object.freeze([
  // ── armas (uma por classe em cada degrau) ──
  G("espada_aprendiz", "weapon", "Espada de aprendiz", "common", { clan: "vampiro", bonus: { dmg: 0 }, starter: true, sell: 10 }),
  G("cajado_aprendiz", "weapon", "Cajado de aprendiz", "common", { clan: "raposa", bonus: { dmg: 0 }, starter: true, sell: 10 }),
  G("espada_latao", "weapon", "Espada de latão", "uncommon", { clan: "vampiro", price: 600, level: 2, bonus: { dmg: 0.05 }, sell: 90 }),
  G("cajado_latao", "weapon", "Cajado de latão", "uncommon", { clan: "raposa", price: 600, level: 2, bonus: { dmg: 0.05 }, sell: 90 }),
  G("espada_eter", "weapon", "Espada de éter", "rare", { clan: "vampiro", level: 3, bonus: { dmg: 0.1, power: 0.05 }, sell: 200 }),
  G("cajado_eter", "weapon", "Cajado de éter", "rare", { clan: "raposa", level: 3, bonus: { dmg: 0.1, power: 0.05 }, sell: 200 }),
  // ── proteção ──
  G("colete_couro", "armor", "Colete de couro", "common", { price: 250, bonus: { def: 0.05 }, sell: 35 }),
  G("couraca_rebitada", "armor", "Couraça rebitada", "uncommon", { price: 700, level: 3, bonus: { def: 0.08 }, sell: 100 }),
  // ── acessórios ──
  G("relogio_bolso", "accessory", "Relógio de bolso", "common", { price: 300, bonus: { warn: 0.05 }, sell: 40 }),
  G("luvas_precisao", "accessory", "Luvas de precisão", "uncommon", { price: 420, level: 2, bonus: { stam: 0.05 }, sell: 60 }),
  G("amuleto_aurion", "accessory", "Amuleto de Aurion", "rare", { bonus: { power: 0.1 }, sell: 0 }),
  // ── materiais (por família de atividade) ──
  G("fragmento_lamina", "material", "Fragmento de lâmina", "common", { family: "forja", sell: 4 }),
  G("nucleo_eter", "material", "Núcleo de éter", "uncommon", { family: "forja", sell: 12 }),
  G("selo_forja", "material", "Selo de forja", "rare", { family: "forja", sell: 30 }),
  G("couro_reforcado", "material", "Couro reforçado", "common", { family: "couro", sell: 4 }),
  G("rebite", "material", "Rebites", "common", { family: "couro", sell: 3 }),
  G("pigmento_eter", "material", "Pigmento de éter", "uncommon", { family: "pigmento", sell: 10 }),
  G("mola_precisao", "material", "Mola de precisão", "common", { family: "mola", sell: 4 }),
  G("injetor_vapor", "material", "Injetor de vapor", "common", { family: "vapor", sell: 5 }),
  G("capacitor", "material", "Capacitor", "common", { family: "capacitor", sell: 5 }),
  G("rolamento", "material", "Rolamento", "common", { family: "rolamento", sell: 4 }),
  // ── receita, missão, cosmético ──
  G("receita_eter", "recipe", "Receita: armas de éter", "rare", { sell: 0 }),
  G("cristal_morkhan", "quest", "Cristal rachado de Morkhan", "epic", { sell: 0 }),
  G("pintura_arma_eter", "cosmetic", "Pintura de arma: éter", "rare", { sell: 0 }),
]);
const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

/** Família → material comum garantido, incomum (chance) e raro (chance). */
const LOOT = Object.freeze({
  forja: { base: "fragmento_lamina", uncommon: "nucleo_eter", rare: "selo_forja" },
  couro: { base: "couro_reforcado", uncommon: "rebite", rare: null },
  pigmento: { base: "pigmento_eter", uncommon: null, rare: null },
  mola: { base: "mola_precisao", uncommon: null, rare: null },
  vapor: { base: "injetor_vapor", uncommon: null, rare: null },
  capacitor: { base: "capacitor", uncommon: null, rare: null },
  rolamento: { base: "rolamento", uncommon: null, rare: null },
});

/** Receitas fixas da forja (prévia clara: entra isto, sai aquilo). */
const RECIPES = Object.freeze([
  { id: "forjar_espada_eter", out: "espada_eter", needs: { fragmento_lamina: 6, nucleo_eter: 3 }, coins: 400, recipe: "receita_eter", level: 3 },
  { id: "forjar_cajado_eter", out: "cajado_eter", needs: { fragmento_lamina: 6, nucleo_eter: 3 }, coins: 400, recipe: "receita_eter", level: 3 },
  { id: "forjar_couraca", out: "couraca_rebitada", needs: { couro_reforcado: 6, rebite: 8 }, coins: 150, recipe: null, level: 3 },
  { id: "forjar_luvas", out: "luvas_precisao", needs: { couro_reforcado: 3, mola_precisao: 4 }, coins: 90, recipe: null, level: 2 },
]);
const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/** Qual arma de aprendiz é a da classe. */
const starterOf = (clan) => (clan === "raposa" ? "cajado_aprendiz" : clan === "vampiro" ? "espada_aprendiz" : null);

/** Slot onde um item entra (acessório escolhe 1 ou 2). */
function slotsFor(item) {
  if (!item) return [];
  if (item.category === "weapon") return ["weapon"];
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
  const sum = { dmg: 0, def: 0, stam: 0, warn: 0, power: 0 };
  for (const slot of SLOTS) {
    const e = equipped && equipped[slot];
    const it = e && GEAR_BY_ID.get(e.id);
    if (!it || !it.bonus) continue;
    for (const [k, v] of Object.entries(it.bonus)) sum[k] += v || 0;
    const lv = Math.max(0, Math.min(UPGRADE.MAX, e.level || 0));
    if (it.category === "weapon") sum.dmg += lv * UPGRADE.DMG;
    if (it.category === "armor") sum.def += lv * UPGRADE.DEF;
  }
  for (const k of Object.keys(sum)) sum[k] = Math.round(Math.min(GEAR_CAP[k], sum[k]) * 10000) / 10000;
  return sum;
}

/** Custo do próximo aprimoramento (null = no máximo / não aprimora). */
function upgradeCost(item, level) {
  if (!item || (item.category !== "weapon" && item.category !== "armor")) return null;
  const lv = Math.max(0, level || 0);
  if (lv >= UPGRADE.MAX) return null;
  const mat = item.category === "weapon" ? "fragmento_lamina" : "couro_reforcado";
  return { coins: UPGRADE.COINS[lv], needs: { [mat]: UPGRADE.MATS[lv] }, to: lv + 1 };
}

/**
 * Drop de uma atividade VALIDADA. Recompensa básica útil GARANTIDA (o material
 * comum da família); vitória aumenta a quantidade e abre as chances. Nunca
 * depende de sorte rara para a missão (missões pedem o material comum).
 * `R` = sorteio 0–1 (o servidor passa o seu).
 */
function rollLoot(family, { win, activeMs }, R) {
  const t = LOOT[family];
  if (!t) return [];
  const out = new Map();
  const add = (id, n) => id && n > 0 && out.set(id, (out.get(id) || 0) + n);
  const minutes = Math.max(0, activeMs) / 60000;
  add(t.base, Math.max(1, Math.min(4, Math.round(minutes / 2))) + (win ? 1 : 0));
  if (win && t.uncommon && R() < 0.35) add(t.uncommon, 1);
  if (win && t.rare && R() < 0.06) add(t.rare, 1);
  return [...out.entries()].map(([id, qty]) => ({ id, qty, rarity: GEAR_BY_ID.get(id).rarity }));
}

/** Catálogo público (o front traduz o nome por id; aqui vai o pt como reserva). */
function publicGear() {
  return {
    slots: SLOTS,
    cap: GEAR_CAP,
    upgrade: { max: UPGRADE.MAX, dmg: UPGRADE.DMG, def: UPGRADE.DEF },
    items: GEAR.map((g) => ({ id: g.id, category: g.category, name: g.name, rarity: g.rarity, price: g.price, level: g.level, clan: g.clan, bonus: g.bonus, family: g.family, stack: g.stack, sell: g.sell })),
    recipes: RECIPES,
  };
}

module.exports = {
  SLOTS,
  CATEGORIES,
  RARITIES,
  GEAR_CAP,
  UPGRADE,
  STACK_MAX,
  GEAR,
  GEAR_BY_ID,
  LOOT,
  RECIPES,
  RECIPE_BY_ID,
  starterOf,
  slotsFor,
  canEquip,
  gearBonus,
  upgradeCost,
  rollLoot,
  publicGear,
};
