// src/utils/boleto.js
//
// LINHA DIGITÁVEL — fonte única da validação do feed de boletos (A2, mig 338).
//
// Dois formatos (padrão Febraban):
//
//   BANCÁRIO (47 dígitos) — 3 campos com DV módulo 10, DV geral módulo 11
//     sobre o código de barras de 44 posições, e o campo 5 com o FATOR DE
//     VENCIMENTO (4) + VALOR em centavos (10).
//
//   CONCESSIONÁRIA / ARRECADAÇÃO (48 dígitos, começa com 8) — 4 blocos de
//     11 dígitos + DV. O 3º dígito diz o módulo (6/7 = 10, 8/9 = 11) e se o
//     valor é real (6/8) ou referência (7/9). O vencimento NÃO faz parte do
//     padrão: nesse formato ele vem informado pela pessoa.
//
// ⚠️ VALOR E VENCIMENTO DO BANCÁRIO SÃO LIDOS DO CÓDIGO, nunca digitados: é o
// que impede alguém de publicar "R$ 50" num boleto de R$ 500.
//
// ⚠️ O FATOR DE VENCIMENTO REINICIOU em 22/02/2025 (fator 1000), depois de
// chegar a 9999 a partir da base 07/10/1997. O mesmo fator aponta para duas
// datas a ~25 anos de distância; fica a mais perto de hoje.

const DAY_MS = 86400000;
const BASE_1997 = Date.UTC(1997, 9, 7);
const BASE_2025 = Date.UTC(2025, 1, 22);

function onlyDigits(raw) {
  return String(raw ?? "").replace(/\D+/g, "");
}

function mod10(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    let p = Number(digits[i]) * weight;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function weightedMod11Sum(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum;
}

/** DV geral do código de barras BANCÁRIO (0, 10 e 11 viram 1). */
function mod11Bank(digits) {
  const dv = 11 - (weightedMod11Sum(digits) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da ARRECADAÇÃO (resto 0/1 → 0; resto 10 → 1). */
function mod11Utility(digits) {
  const rest = weightedMod11Sum(digits) % 11;
  if (rest === 0 || rest === 1) return 0;
  if (rest === 10) return 1;
  return 11 - rest;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Hoje no fuso de Brasília, em YYYY-MM-DD. */
function todayBrasilia(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dueFromFactor(factor, todayIso) {
  if (!factor) return null;
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const candidates = [BASE_1997 + factor * DAY_MS];
  if (factor >= 1000) candidates.push(BASE_2025 + (factor - 1000) * DAY_MS);
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - today) < Math.abs(best - today)) best = c;
  }
  return isoDate(best);
}

function parseBank(d, todayIso) {
  const f1 = d.slice(0, 9);
  const f2 = d.slice(10, 20);
  const f3 = d.slice(21, 31);
  if (mod10(f1) !== Number(d[9]) || mod10(f2) !== Number(d[20]) || mod10(f3) !== Number(d[31])) {
    return { error: "Linha digitável inválida: confira os números.", code: "invalid_dv" };
  }
  const barcode = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  if (mod11Bank(barcode.slice(0, 4) + barcode.slice(5)) !== Number(barcode[4])) {
    return { error: "Linha digitável inválida: confira os números.", code: "invalid_dv" };
  }
  const factor = Number(d.slice(33, 37));
  const amount_cents = Number(d.slice(37, 47));
  return {
    ok: true,
    kind: "bank",
    digits: d,
    barcode,
    amount_cents,
    due_date: dueFromFactor(factor, todayIso),
  };
}

function parseUtility(d) {
  const valueId = d[2];
  if (!["6", "7", "8", "9"].includes(valueId)) {
    return { error: "Linha de concessionária inválida.", code: "invalid_format" };
  }
  const check = valueId === "6" || valueId === "7" ? mod10 : mod11Utility;
  let barcode = "";
  for (let b = 0; b < 4; b++) {
    const block = d.slice(b * 12, b * 12 + 11);
    if (check(block) !== Number(d[b * 12 + 11])) {
      return { error: "Linha digitável inválida: confira os números.", code: "invalid_dv" };
    }
    barcode += block;
  }
  if (check(barcode.slice(0, 3) + barcode.slice(4)) !== Number(barcode[3])) {
    return { error: "Linha digitável inválida: confira os números.", code: "invalid_dv" };
  }
  if (valueId === "7" || valueId === "9") {
    return {
      error: "Este boleto não traz o valor no código (valor de referência).",
      code: "reference_value",
    };
  }
  return {
    ok: true,
    kind: "utility",
    digits: d,
    barcode,
    amount_cents: Number(barcode.slice(4, 15)),
    due_date: null,
  };
}

/**
 * Lê e confere uma linha digitável. Não olha prazo nem limites (isso é do
 * `checkBill`): só diz se os números são um boleto de verdade.
 */
function parseLine(raw, { today } = {}) {
  const d = onlyDigits(raw);
  const todayIso = today || todayBrasilia();
  if (d.length === 47) return parseBank(d, todayIso);
  if (d.length === 48 && d[0] === "8") return parseUtility(d);
  return {
    error: "Digite a linha digitável completa (47 números, ou 48 começando com 8).",
    code: "invalid_length",
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A régua do feed: linha válida, com valor, dentro do teto, não vencida.
 * `due_date` informado só vale para concessionária (no bancário o código manda).
 */
function checkBill(raw, { due_date: informed, max_amount_cents, today } = {}) {
  const todayIso = today || todayBrasilia();
  const parsed = parseLine(raw, { today: todayIso });
  if (parsed.error) return parsed;

  let due = parsed.due_date;
  if (parsed.kind === "utility") {
    if (!informed || !ISO_DATE.test(String(informed)) || Number.isNaN(Date.parse(informed))) {
      return { error: "Informe o vencimento da conta.", code: "due_required" };
    }
    due = String(informed);
  }
  if (!due) {
    return { error: "Este boleto não tem vencimento no código.", code: "no_due" };
  }
  if (due < todayIso) {
    return { error: "Boleto vencido não entra no feed.", code: "expired" };
  }
  if (!parsed.amount_cents || parsed.amount_cents <= 0) {
    return { error: "Este boleto não tem valor no código.", code: "no_amount" };
  }
  if (max_amount_cents && parsed.amount_cents > max_amount_cents) {
    return {
      error: `O teto por boleto é R$ ${(max_amount_cents / 100).toFixed(2).replace(".", ",")}.`,
      code: "over_limit",
    };
  }
  return { ...parsed, due_date: due };
}

/** Linha formatada para exibir a quem reservou (grupos como no papel). */
function formatLine(digits) {
  const d = onlyDigits(digits);
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  }
  if (d.length === 48) {
    return [0, 1, 2, 3].map((b) => `${d.slice(b * 12, b * 12 + 11)}-${d[b * 12 + 11]}`).join(" ");
  }
  return d;
}

module.exports = {
  onlyDigits,
  mod10,
  mod11Bank,
  mod11Utility,
  todayBrasilia,
  dueFromFactor,
  parseLine,
  checkBill,
  formatLine,
};
