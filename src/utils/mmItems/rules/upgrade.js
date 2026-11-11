// src/utils/mmItems/rules/upgrade.js — trilha E, fatia E9: APRIMORAMENTO GARANTIDO (forge-v2), regra pura.
//
// O sorteio da forge-v1 (sobe/fica/desce com proposta) acabou: cada passo de +0 a +15 tem custo fixo
// e SEMPRE sobe. Custo do passo n (§6.5 do plano 2026-11-11):
//   Esmeraldas = vitórias[n] × renda do nível de referência do tier, arredondado a 10 (budget.upgradeEmeralds)
//   Pedras de Aprimoramento = STONES[n]
// Do +11 em diante só depois da Ascensão (E14). Quem pagou e confere é o serviço (recibo + livro).
"use strict";

const B = require("./budget");

const RULES_VERSION = "forge-v2";
const MAX_PLUS = B.PLUS_MAX;
const STONE = "pedra_aprimoramento";

/** Todo equipamento com slot sobe (arma, mão secundária, proteção, acessório). */
const upgradable = (item) => !!item && !!item.slot && !!item.tier;

/**
 * Custo do PRÓXIMO passo: { from, to, coins, needs, ascension } ou null (não sobe / no +15).
 * `ascension: true` = o passo pede a peça ascendida (o serviço recusa se não for).
 */
function upgradeCost(item, plus) {
  if (!upgradable(item)) return null;
  const from = Math.floor(Number(plus));
  if (!Number.isInteger(from) || from < 0 || from >= MAX_PLUS) return null;
  const to = from + 1;
  return {
    rulesVersion: RULES_VERSION, from, to,
    coins: B.upgradeEmeralds(item.tier, to),
    needs: { [STONE]: B.STONES[to - 1] },
    ascension: to >= B.ASCEND_FROM,
  };
}

/** Total de +0 até +n (Esmeraldas e Pedras), para a tela e o balanço. */
function upgradeTotal(item, n = MAX_PLUS) {
  let coins = 0, stones = 0;
  for (let p = 0; p < Math.min(n, MAX_PLUS); p++) {
    const c = upgradeCost(item, p);
    if (!c) break;
    coins += c.coins;
    stones += c.needs[STONE];
  }
  return { coins, stones };
}

/** A A2: quem tinha +N da forge-v1 vira +round(1,5 × N); passou de +10, nasce ascendido. */
const convertV1 = (plus) => {
  const to = Math.min(MAX_PLUS, Math.round(1.5 * Math.max(0, Math.floor(plus) || 0)));
  return { plus: to, ascended: to > 10 };
};

module.exports = { RULES_VERSION, MAX_PLUS, STONE, upgradable, upgradeCost, upgradeTotal, convertV1 };
