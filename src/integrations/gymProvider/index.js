// src/integrations/gymProvider/index.js
// Cliente HTTP do contrato "Gym Provider API" (docs/API_GYM_PROVIDER.md).
// O software da academia (Coliseu é a 1ª implementação) expõe 3 endpoints GET;
// aqui só montamos URL + Bearer + timeout e normalizamos erros em { error }.
const { createLogger } = require("../../utils/logger");

const log = createLogger("gym-provider");
const TIMEOUT_MS = 10_000;

function buildUrl(baseUrl, path, params) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function call(baseUrl, token, path, params, { method = "GET", body } = {}) {
  const url = buildUrl(baseUrl, path, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { error: "Token da API da academia recusado", auth_error: true, status: res.status };
    }
    if (!res.ok) {
      return { error: `API da academia respondeu ${res.status}`, status: res.status };
    }
    return { data: await res.json() };
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    log.warn("call.fail", { path, timedOut, error: err.message });
    return { error: timedOut ? "API da academia demorou demais (timeout)" : "API da academia inacessível" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  // { found, name?, membership? } — matrícula por CPF (11 dígitos).
  getMember(baseUrl, token, cpf) {
    return call(baseUrl, token, "/api/freelandoo/member", { cpf });
  },
  // { events: [{id,cpf,at,passed}], next_cursor }
  getAccessEvents(baseUrl, token, since, limit = 200) {
    return call(baseUrl, token, "/api/freelandoo/access-events", { since, limit });
  },
  // { payments: [{id,cpf,amount_cents,due_date,status,paid_at,method?}], next_cursor }
  getPayments(baseUrl, token, since, limit = 200) {
    return call(baseUrl, token, "/api/freelandoo/payments", { since, limit });
  },

  // ── Pagar pela Freelandoo (mig 310) ─────────────────────────────────────
  // Opcionais no contrato: academia que não implementa responde 404 aqui e o
  // "Pagar" simplesmente não aparece para os alunos dela.

  // { supports_paid_callback: boolean }
  getCapabilities(baseUrl, token) {
    return call(baseUrl, token, "/api/freelandoo/capabilities");
  },
  // { id, cpf, amount_cents, due_date, status, paid_at, method? } — a cobrança
  // AGORA, reconferida antes de abrir o checkout (o espelho pode ter 10 min).
  getPayment(baseUrl, token, id) {
    return call(baseUrl, token, `/api/freelandoo/payments/${encodeURIComponent(id)}`);
  },
  // Baixa: o aluno pagou pela Freelandoo. Idempotente por `ref` do lado de lá.
  markPaid(baseUrl, token, id, { amount_cents, paid_at, ref }) {
    return call(baseUrl, token, `/api/freelandoo/payments/${encodeURIComponent(id)}/paid`, null, {
      method: "POST",
      body: { amount_cents, paid_at, ref },
    });
  },
  // Estorno antes do repasse: a cobrança volta a ficar em aberto lá.
  reopen(baseUrl, token, id, { ref }) {
    return call(baseUrl, token, `/api/freelandoo/payments/${encodeURIComponent(id)}/reopened`, null, {
      method: "POST",
      body: { ref },
    });
  },
};
