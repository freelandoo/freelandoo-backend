// src/utils/mmItems/rules/enchant.js — trilha E, fatia E15: ENCANTAMENTO, regra pura.
//
// O encanto troca a CHAVE SECUNDÁRIA da cópia por outra do slot. Pagar sorteia até 3 opções (chaves
// do slot que não são a principal nem a secundária de agora); o jogador aceita uma ou mantém a atual.
// Recusar não cobra de novo (o custo foi pago no sorteio) e não muda nada. A chave encantada soma,
// além da parte da peça (ênfase 0,5), a fatia `enchant` (0,05 do teto) pesada pelo slot — todos os
// slots da chave encantados = a fatia inteira (subteto em bonus.js).
// Custo do sorteio: 10 × tier Pó de Refino + tier Cristal Bruto. Quem confere e grava é o serviço.
"use strict";

const B = require("./budget");

const POWDER = "po_refino";
const CRYSTAL = "cristal_bruto";
const OPTIONS = 3;

const enchantable = (item) => !!item && !!item.slot && !!item.tier && Array.isArray(item.keys);

/** As duas chaves que valem na cópia (a secundária pode ter sido encantada). */
function effectiveKeys(item, enchant) {
  if (!enchantable(item)) return item && item.keys ? item.keys : [];
  return enchant && enchant !== item.keys[0] && B.WEIGHT[enchant] && B.WEIGHT[enchant][item.slot] ? [item.keys[0], enchant] : item.keys;
}

/** Chaves que podem sair no sorteio para esta cópia. */
function pool(item, enchant) {
  if (!enchantable(item)) return [];
  const [main, second] = effectiveKeys(item, enchant);
  return B.slotKeys(item.slot).filter((k) => k !== main && k !== second);
}

/** Custo de um sorteio: { needs } ou { error: "item" | "offer" | "noenchant" } (`pending` = há sorteio esperando escolha). */
function enchantCost(item, enchant, pending = false) {
  if (!enchantable(item)) return { error: "item" };
  if (pending) return { error: "offer" };
  if (!pool(item, enchant).length) return { error: "noenchant" };
  return { coins: 0, needs: { [POWDER]: 10 * item.tier, [CRYSTAL]: item.tier } };
}

/** Sorteia até 3 opções distintas (`R` = 0…1 do servidor). */
function rollOptions(item, enchant, R) {
  const left = pool(item, enchant).slice();
  const out = [];
  while (left.length && out.length < OPTIONS) out.push(left.splice(Math.floor(R() * left.length), 1)[0]);
  return out;
}

/** O que o encanto soma (sem subteto): { chave: CAP × 0,05 × peso do slot }. */
function enchantValue(item, k) {
  if (!enchantable(item) || !k || !B.WEIGHT[k]) return {};
  return { [k]: B.sourceCap(k, "enchant") * (B.WEIGHT[k][item.slot] || 0) };
}

module.exports = { POWDER, CRYSTAL, OPTIONS, enchantable, effectiveKeys, pool, enchantCost, rollOptions, enchantValue };
