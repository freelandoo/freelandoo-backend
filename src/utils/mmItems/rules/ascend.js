// src/utils/mmItems/rules/ascend.js — trilha E, fatia E14: ASCENSÃO e DESPERTAR, regra pura.
//
// Ascensão (§6.5): a cópia no +10 paga 2 × tier Selos de Domínio e passa a aceitar +11…+15 e 1 engaste
// a mais (rules/runes.socketsOf). Despertar: a cópia ascendida paga tier Essências Primordiais + tier
// Selos e liga a passiva — a fatia `awaken` (0,05 do teto) na CHAVE PRINCIPAL da peça, pesada pelo slot
// (todos os slots da chave despertos = a fatia inteira; subteto em bonus.js).
// Quem confere posse, trava e recibo é o serviço.
"use strict";

const B = require("./budget");

const SEAL = "selo_dominio";
const ESSENCE = "essencia_primordial";
/** O aprimoramento para no +10 sem a Ascensão (ASCEND_FROM − 1). */
const ASCEND_AT = B.ASCEND_FROM - 1;

const ascendable = (item) => !!item && !!item.slot && !!item.tier && Array.isArray(item.keys);

/** Custo da Ascensão: { needs } ou { error: "item" | "ascended" | "plus" }. */
function ascendCost(item, inst) {
  if (!ascendable(item)) return { error: "item" };
  if (inst.ascended) return { error: "ascended" };
  if ((inst.plus || 0) < ASCEND_AT) return { error: "plus" };
  return { coins: 0, needs: { [SEAL]: 2 * item.tier } };
}

/** Custo do Despertar: { needs } ou { error: "item" | "awakened" | "notascended" }. */
function awakenCost(item, inst) {
  if (!ascendable(item)) return { error: "item" };
  if (inst.awakened) return { error: "awakened" };
  if (!inst.ascended) return { error: "notascended" };
  return { coins: 0, needs: { [ESSENCE]: item.tier, [SEAL]: item.tier } };
}

/** O que a passiva soma (sem subteto): { chave principal: CAP × 0,05 × peso do slot }. */
function awakenValue(item) {
  if (!ascendable(item)) return {};
  const k = item.keys[0];
  return { [k]: B.sourceCap(k, "awaken") * ((B.WEIGHT[k] && B.WEIGHT[k][item.slot]) || 0) };
}

module.exports = { SEAL, ESSENCE, ASCEND_AT, ascendable, ascendCost, awakenCost, awakenValue };
