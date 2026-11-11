// src/utils/mmItems/rules/salvage.js — trilha E, fatia E11: DESMONTAR e TRANSMUTAR, regra pura.
//
// Desmontar (§6.5 do plano 2026-11-11): a cópia vira 35% (para baixo) de cada material da receita
// que a fabrica + Pó de Refino = 10 × tier × (1 + plus ÷ 5). Nunca Esmeralda. Peça sem receita (da
// loja, do saque) devolve só o Pó. Como 35% < 50%, fabricar → desmontar → fabricar sempre perde (I7).
// Transmutar: 3 de um material → 1 de outro do MESMO tier e da mesma categoria, + 20 × tier Esmeraldas.
// Peça da forja (`component`) e item de missão não transmutam.
// Quem confere posse, trava, quem veste e recibo é o serviço.
"use strict";

const SALVAGE_SHARE = 0.35;
const POWDER = "po_refino";
const TRANSMUTE_IN = 3;
const TRANSMUTE_COINS = 20;
/** Raro ou acima pede confirmação explícita para desmontar. */
const CONFIRM_TIER = 3;

/** A receita que fabrica o item (a primeira; equipamento tem uma só). */
const recipeOf = (item, recipes) => recipes.find((r) => r.out === item.id) || null;

/**
 * O que a cópia devolve: { [id]: qty } (só o que for > 0). `byId` = catálogo (para não devolver
 * projeto/receita que porventura esteja nos ingredientes).
 */
function salvageYield(item, plus, recipes, byId) {
  if (!item || !item.slot || !item.tier) return null;
  const out = {};
  const rc = recipeOf(item, recipes);
  if (rc) {
    for (const [id, n] of Object.entries(rc.needs)) {
      const ing = byId.get(id);
      if (!ing || ing.category === "recipe") continue;
      const back = Math.floor(n * SALVAGE_SHARE);
      if (back > 0) out[id] = back;
    }
  }
  const p = Math.max(0, Math.floor(Number(plus) || 0));
  out[POWDER] = (out[POWDER] || 0) + Math.round(10 * item.tier * (1 + p / 5));
  return out;
}

/** Pode entrar numa transmutação (dos dois lados)? */
const transmutable = (item) => !!item && item.category === "material" && !item.component && !!item.tier;

/** Custo de `n` transmutações de `from` em `to`: { needs, coins, gives } ou { error }. */
function transmuteCost(from, to, n = 1) {
  if (!transmutable(from) || !transmutable(to)) return { error: "transmute" };
  if (from.id === to.id) return { error: "transmute" };
  if (from.tier !== to.tier || from.category !== to.category) return { error: "transmute" };
  const times = Math.floor(Number(n));
  if (!Number.isInteger(times) || times < 1 || times > 999) return { error: "transmute" };
  return { needs: { [from.id]: TRANSMUTE_IN * times }, coins: TRANSMUTE_COINS * from.tier * times, gives: { [to.id]: times } };
}

module.exports = { SALVAGE_SHARE, POWDER, TRANSMUTE_IN, TRANSMUTE_COINS, CONFIRM_TIER, recipeOf, salvageYield, transmutable, transmuteCost };
