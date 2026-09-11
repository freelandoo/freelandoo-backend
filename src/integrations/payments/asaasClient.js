// src/integrations/payments/asaasClient.js
// O ÚNICO lugar do backend que fala HTTP com o Asaas.
//
// ─── SEM ENV, O MÓDULO SE DECLARA NÃO CONFIGURADO ───────────────────────────
//
// `config()` devolve `null` e quem chama responde que a integração não está
// disponível. É a regra das migs 214/220/223: quem decide se o provedor existe
// é a ENV, não a flag — flag ligada sem credencial produz um botão de pagar que
// só falha depois do clique, já com a pessoa decidida a comprar.
//
// ─── SANDBOX É O PADRÃO, E ISSO É PROPOSITAL ────────────────────────────────
//
// `ASAAS_ENV` precisa dizer `production` EXPLICITAMENTE para o dinheiro ser
// real. Um erro de digitação (`prod`, `prd`, vazio) cai no sandbox, onde o pior
// caso é um pagamento de teste que não acontece. O contrário — produção por
// omissão — cobraria de verdade um cliente durante um teste.

const { createLogger } = require("../../utils/logger");

const log = createLogger("AsaasClient");

const TIMEOUT_MS = 20_000;

const BASE_URL = Object.freeze({
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
});

class AsaasError extends Error {
  constructor(message, statusCode = 502, raw = null) {
    super(message);
    this.name = "AsaasError";
    this.statusCode = statusCode;
    this.raw = raw;
  }
}

/** `production` só com a palavra inteira; qualquer outra coisa é sandbox. */
function environment() {
  const raw = String(process.env.ASAAS_ENV || "").trim().toLowerCase();
  return raw === "production" ? "production" : "sandbox";
}

/** `null` = provedor não configurado neste ambiente. */
function config() {
  const apiKey = String(process.env.ASAAS_API_KEY || "").trim();
  if (!apiKey) return null;
  const env = environment();
  return {
    env,
    apiKey,
    url: String(process.env.ASAAS_API_URL || BASE_URL[env]).replace(/\/+$/, ""),
    webhookToken: String(process.env.ASAAS_WEBHOOK_TOKEN || "").trim(),
  };
}

function isConfigured() {
  return !!config();
}

/**
 * ⚠️ CENTAVOS → REAIS, e este é o ponto de dinheiro mais fácil de errar da
 * integração inteira. A plataforma trabalha em CENTAVOS (inteiro) do começo ao
 * fim; o Asaas recebe `value` em REAIS com decimal. Mandar 1990 onde ele espera
 * 19.90 cobra mil novecentos e noventa reais de alguém.
 *
 * O `toFixed(2)` antes do `Number` não é enfeite: 0.1+0.2 em ponto flutuante
 * produz caudas como 19.900000000000002, e o Asaas recusa (ou arredonda) valor
 * com mais de duas casas.
 */
function centsToReais(amount_cents) {
  const cents = Math.round(Number(amount_cents) || 0);
  return Number((cents / 100).toFixed(2));
}

/** REAIS → CENTAVOS, para reidratar o que volta do webhook na régua da casa. */
function reaisToCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

/**
 * Data de vencimento no fuso de SÃO PAULO, não em UTC.
 *
 * ⚠️ Em UTC, uma cobrança criada às 21h de São Paulo já nasce "amanhã" — e um
 * boleto com vencimento contado do dia errado vence um dia antes do combinado.
 * A mesma régua do dia dos indicadores do negócio (mig 235).
 */
function dueDateFromNow(daysAhead = 3) {
  const now = new Date(Date.now() + Math.max(0, daysAhead) * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** O Asaas devolve o erro numa lista `errors[]`, não numa string. */
function errorMessage(data, status) {
  const first = Array.isArray(data?.errors) ? data.errors[0] : null;
  const raw = first?.description || data?.message || data?.error;
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 300);
  return `Falha na comunicação com o Asaas (HTTP ${status}).`;
}

async function call(method, path, body) {
  const cfg = config();
  if (!cfg) throw new AsaasError("Asaas não configurado neste ambiente", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${cfg.url}${path}`, {
      method,
      headers: {
        access_token: cfg.apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    let data = {};
    try {
      data = (await r.json()) || {};
    } catch {
      data = {};
    }

    if (r.status >= 400) {
      // ⚠️ O corpo NUNCA entra no log: ele carrega CPF e nome de quem paga.
      log.warn("call.fail", { method, path, status: r.status });
      throw new AsaasError(errorMessage(data, r.status), r.status, data);
    }
    return data;
  } catch (e) {
    if (e instanceof AsaasError) throw e;
    const why = e && e.name === "AbortError" ? "tempo esgotado" : "sem resposta";
    throw new AsaasError(`Asaas indisponível (${why}). Tente de novo em instantes.`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────── Clientes ───────────────────────────────────

function createCustomer({ name, cpfCnpj, email, mobilePhone, externalReference }) {
  return call("POST", "/customers", {
    name,
    cpfCnpj,
    ...(email ? { email } : {}),
    ...(mobilePhone ? { mobilePhone } : {}),
    ...(externalReference ? { externalReference } : {}),
  });
}

/**
 * Procura o cliente pelo nosso id_user.
 *
 * ⚠️ Existe para o caso em que a linha local perdeu o id mas o cliente já está
 * lá (restauração de backup, criação que gravou no Asaas e falhou aqui). Sem
 * isto, o get-or-create tentaria criar de novo e o Asaas recusaria por CPF
 * duplicado — deixando a conta sem conseguir pagar, sem saída.
 */
async function findCustomerByExternalReference(externalReference) {
  const data = await call(
    "GET",
    `/customers?externalReference=${encodeURIComponent(externalReference)}&limit=1`
  );
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.find((c) => c && c.deleted !== true) || null;
}

// ─────────────────────────────── Cobranças ──────────────────────────────────

function createPayment(payload) {
  return call("POST", "/payments", payload);
}

function getPayment(id) {
  return call("GET", `/payments/${encodeURIComponent(id)}`);
}

/** Estorno TOTAL. O Asaas aceita parcial por `value`; a casa não usa parcial. */
function refundPayment(id) {
  return call("POST", `/payments/${encodeURIComponent(id)}/refund`, {});
}

/** Remove uma cobrança que ainda NÃO foi paga (equivale a expirar o checkout). */
function deletePayment(id) {
  return call("DELETE", `/payments/${encodeURIComponent(id)}`);
}

// ────────────────────────────── Assinaturas ─────────────────────────────────

function createSubscription(payload) {
  return call("POST", "/subscriptions", payload);
}

function getSubscription(id) {
  return call("GET", `/subscriptions/${encodeURIComponent(id)}`);
}

/**
 * ⚠️ No Asaas cancelar assinatura é DELETE e é IMEDIATO — não existe o
 * `cancel_at_period_end` do Stripe. Quem precisa de "vale até o fim do ciclo"
 * tem que guardar a data do lado de cá e só chamar isto quando ela chegar.
 */
function cancelSubscription(id) {
  return call("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
}

module.exports = {
  AsaasError,
  BASE_URL,
  environment,
  config,
  isConfigured,
  centsToReais,
  reaisToCents,
  dueDateFromNow,
  createCustomer,
  findCustomerByExternalReference,
  createPayment,
  getPayment,
  refundPayment,
  deletePayment,
  createSubscription,
  getSubscription,
  cancelSubscription,
};
