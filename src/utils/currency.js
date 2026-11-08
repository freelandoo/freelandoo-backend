// src/utils/currency.js — A7: as duas moedas da Freelandoo (fonte única).
//
// GOLD      = o antigo Pólen, redenominado (mig 329): 1 Gold = R$ 1. Só se
//             obtém comprando (ou recebendo presente de live que alguém
//             comprou). Carteira: polen_wallets / polen_transactions.
// ESMERALDA = a moeda que se GANHA (nível, anúncio, engajamento, Meu Mundo) ou
//             convertendo Gold. 1 Gold = 1.000 Esmeralda. Esmeralda NUNCA vira
//             Gold. Carteira: emerald_wallets / emerald_transactions (mig 330).
//
// Preço em Esmeralda: NULL = regra padrão (Gold × 1.000), 0 = não vende nessa
// moeda, > 0 = definido pelo admin.

const EMERALD_PER_GOLD = 1000;
const CURRENCIES = Object.freeze(["gold", "emerald"]);

/** Preço efetivo em Esmeralda de um produto que tem preço em Gold. */
function emeraldPrice(goldPrice, override) {
  if (override != null && override !== "") {
    const n = Math.floor(Number(override));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const g = Math.floor(Number(goldPrice) || 0);
  return g > 0 ? g * EMERALD_PER_GOLD : 0;
}

/** `currency` do corpo da requisição → "gold" | "emerald" | null (inválida). */
function parseCurrency(raw, fallback = "gold") {
  if (raw == null || raw === "") return fallback;
  const v = String(raw).toLowerCase();
  if (v === "polens" || v === "polen") return "gold"; // nome antigo da mesma moeda
  return CURRENCIES.includes(v) ? v : null;
}

/** Desconto do cupom Gold: `per10` Gold a cada R$ 10 (múltiplos de R$ 10). */
function couponGoldCost(discountCents, per10 = 12) {
  const tens = Math.floor(Number(discountCents) / 1000);
  if (!Number.isInteger(tens) || tens <= 0 || tens * 1000 !== Number(discountCents)) return null;
  return tens * per10;
}

module.exports = { EMERALD_PER_GOLD, CURRENCIES, emeraldPrice, parseCurrency, couponGoldCost };
