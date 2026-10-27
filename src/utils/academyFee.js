// src/utils/academyFee.js
// O dinheiro da mensalidade paga pela Freelandoo (mig 310) — contas puras.
//
// Quem paga é o aluno, o valor EXATO da cobrança. Da parte dele saem a tarifa
// real do Mercado Pago e os R$ 2,50 da Freelandoo; o resto é da academia.
//
// ⚠️ AS PARTES SOMAM EXATAMENTE O QUE FOI PAGO, E NENHUMA É NEGATIVA. Numa
// mensalidade minúscula (R$ 3) a tarifa + R$ 2,50 passariam do valor: quem
// encolhe é a parte da FREELANDOO, nunca o repasse fica negativo (um repasse
// negativo viraria débito da academia por ter recebido um aluno).
const { isValidCPF, isValidCNPJ } = require("./documents");

function cents(n) {
  return Math.max(0, Math.round(Number(n) || 0));
}

function splitFee({ amountCents, platformFeeCents, processorFeeCents }) {
  const amount = cents(amountCents);
  const processor = Math.min(cents(processorFeeCents), amount);
  const platform = Math.min(cents(platformFeeCents), amount - processor);
  const net = amount - processor - platform;
  return {
    amount_cents: amount,
    processor_fee_cents: processor,
    platform_fee_cents: platform,
    net_cents: net,
    // O que a Freelandoo deixou de cobrar para o repasse não ficar negativo.
    shortfall_cents: cents(platformFeeCents) - platform,
  };
}

// ─── Chave PIX ────────────────────────────────────────────────────────────────
const PIX_TYPES = ["cpf", "cnpj", "email", "phone", "random"];

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

/**
 * Normaliza e confere uma chave PIX pelo tipo. Devolve `{ key }` ou `{ error }`.
 * Celular vai no formato do BACEN (+55DDDNÚMERO).
 */
function normalizePixKey(type, raw) {
  const value = String(raw || "").trim();
  switch (type) {
    case "cpf": {
      const d = digits(value);
      return isValidCPF(d) ? { key: d } : { error: "CPF da chave PIX inválido." };
    }
    case "cnpj": {
      const d = digits(value);
      return isValidCNPJ(d) ? { key: d } : { error: "CNPJ da chave PIX inválido." };
    }
    case "email": {
      const e = value.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77
        ? { key: e }
        : { error: "E-mail da chave PIX inválido." };
    }
    case "phone": {
      let d = digits(value);
      if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
      return d.length === 11 || d.length === 10
        ? { key: `+55${d}` }
        : { error: "Celular da chave PIX inválido (use DDD + número)." };
    }
    case "random": {
      const r = value.toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r)
        ? { key: r }
        : { error: "Chave aleatória inválida." };
    }
    default:
      return { error: "Tipo de chave PIX inválido." };
  }
}

/** "•••• 4521" — o que a tela mostra sem abrir o selo. */
function hintOf(value, keep = 4) {
  const s = String(value || "");
  return s.length <= keep ? s : s.slice(-keep);
}

module.exports = { splitFee, PIX_TYPES, normalizePixKey, hintOf, digits };
