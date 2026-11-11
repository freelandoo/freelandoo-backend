// src/utils/mmItems/rules/forgeV1.js — trilha E, fatia E1: REFINO SORTEADO (forge-v1), regra pura.
// O serviço cuida de saldo, recibo, sorteio e proposta. Movido de meuMundoForge.js sem mudar número;
// a E9 troca pelo aprimoramento garantido (forge-v2, rules/upgrade.js).
"use strict";

const RULES_VERSION = "forge-v1";
const MAX_LEVEL = 10;
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const COINS = Object.freeze([120, 220, 380, 600, 900, 1400, 2100, 3000, 4200, 5800]);
const MATERIALS = Object.freeze([2, 3, 4, 6, 8, 12, 16, 20, 26, 34]);
const NUCLEI = Object.freeze([0, 0, 0, 1, 2, 3, 4, 5, 6, 8]);
const SEALS = Object.freeze([0, 0, 0, 0, 0, 0, 1, 1, 2, 3]);
const SECONDARY_PER_LEVEL = Object.freeze({ stam: 0.004, warn: 0.004, power: 0.01 });

/** A quote contains total costs, including optional protection, never a result. */
function quote(item, currentLevel, options = {}) {
  if (!item || !["weapon", "armor"].includes(item.category)) return null;
  const from = Number(currentLevel);
  if (!Number.isInteger(from) || from < 0 || from >= MAX_LEVEL) return null;
  const failures = Math.max(0, Math.min(3, Math.floor(Number(options.failures) || 0)));
  const protectedAttempt = options.protected === true || options.protection === true;
  const guaranteed = failures >= 3;
  const floor = from >= 6 ? 6 : from >= 3 ? 3 : 0;
  const needs = { [item.category === "weapon" ? "fragmento_lamina" : "couro_reforcado"]: MATERIALS[from] };
  if (NUCLEI[from]) needs.nucleo_eter = NUCLEI[from];
  if (SEALS[from]) needs.selo_forja = SEALS[from];
  let odds = guaranteed ? { up: 1, same: 0, down: 0 } : from < 3 ? { up: 0.75, same: 0.2, down: 0.05 } : from < 6 ? { up: 0.55, same: 0.3, down: 0.15 } : from < 9 ? { up: 0.35, same: 0.4, down: 0.25 } : { up: 0.25, same: 0.45, down: 0.3 };
  // A floor absorbs downgrade probability. Protection is only charged when a
  // downgrade could occur; a guaranteed or floor attempt needs no protection.
  const protectionCost = protectedAttempt && !guaranteed && from > floor ? { selo_forja: from < 3 ? 1 : from < 6 ? 2 : 3 } : {};
  if (from === floor || Object.keys(protectionCost).length) odds = { up: odds.up, same: odds.same + odds.down, down: 0 };
  for (const [id, qty] of Object.entries(protectionCost)) needs[id] = (needs[id] || 0) + qty;
  return {
    rulesVersion: RULES_VERSION, proposalTTLms: PROPOSAL_TTL_MS,
    from, toMax: from + 1, floor, cost: { coins: COINS[from], needs }, odds,
    pity: { failures, guaranteed, guaranteeAfter: 3 },
    protection: { enabled: Object.keys(protectionCost).length > 0, requested: protectedAttempt, cost: { coins: 0, needs: protectionCost } },
  };
}

/** The authenticated service supplies a cryptographically secure random draw. */
function roll(q, R) {
  if (!q || !Number.isInteger(q.from) || !q.odds || typeof R !== "function") throw new TypeError("Invalid refinement quote");
  const draw = R();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError("Random draw must be in [0,1)");
  if (draw < q.odds.up) return Math.min(MAX_LEVEL, q.from + 1);
  if (draw < q.odds.up + q.odds.same) return q.from;
  return Math.max(q.floor, q.from - 1);
}

module.exports = { RULES_VERSION, MAX_LEVEL, PROPOSAL_TTL_MS, COINS, MATERIALS, NUCLEI, SEALS, SECONDARY_PER_LEVEL, quote, roll };
