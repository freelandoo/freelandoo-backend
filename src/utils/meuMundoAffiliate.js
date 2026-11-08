// src/utils/meuMundoAffiliate.js
//
// A8 — afiliado de 10% pelo Meu Mundo 3D. Regra pura (sem banco), fonte única
// de "o que é venda do Meu Mundo" e de "quanto rende".
//
// O que conta: DINHEIRO REAL gasto pelo convidado em compras do Meu Mundo.
//   • Gold comprado de dentro do jogo  → polen_purchase com return_to "meu-mundo"
//     (PolenProductService grava o return_to na metadata da cobrança).
//   • B4 (personagem/item em R$)       → qualquer cobrança com metadata
//     `meu_mundo: "1"` entra aqui sozinha.
// O que NÃO conta: Esmeralda (ganha engajando, nunca passa pelo checkout) e
// Gold comprado fora do jogo (segue o contexto `polen_purchase`, desligado).

const MM_AFFILIATE_CONTEXT = "meu_mundo_purchase";

/** Percentual de referência; o que vale é a linha da mig 350 (o admin pode mudar). */
const MM_AFFILIATE_DEFAULT_PERCENT = 10;

function isMeuMundoSale(meta) {
  if (!meta || typeof meta !== "object") return false;
  if (String(meta.meu_mundo || "") === "1") return true;
  return meta.type === "polen_purchase" && meta.return_to === "meu-mundo";
}

/**
 * Comissão em centavos: % sobre o valor pago, arredondada para BAIXO (nunca
 * paga um centavo a mais do que a regra). Valor inválido ou ≤ 0 = 0.
 */
function meuMundoCommissionCents(totalCents, percent = MM_AFFILIATE_DEFAULT_PERCENT) {
  const total = Math.floor(Number(totalCents));
  const pct = Number(percent);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.floor((total * Math.min(pct, 100)) / 100);
}

/**
 * Autoindicação: mesmo usuário, ou mesma pessoa em duas contas (CPF igual —
 * 1 CPF = 1 conta desde a mig 188, e o CPF é do titular).
 */
function isSelfReferral({ buyerUserId, affiliateUserId, buyerCpf = null, affiliateCpf = null }) {
  if (buyerUserId && affiliateUserId && String(buyerUserId) === String(affiliateUserId)) return true;
  const a = buyerCpf ? String(buyerCpf).replace(/\D/g, "") : "";
  const b = affiliateCpf ? String(affiliateCpf).replace(/\D/g, "") : "";
  return !!a && a === b;
}

module.exports = {
  MM_AFFILIATE_CONTEXT,
  MM_AFFILIATE_DEFAULT_PERCENT,
  isMeuMundoSale,
  meuMundoCommissionCents,
  isSelfReferral,
};
