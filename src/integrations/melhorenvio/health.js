const { createLogger } = require("../../utils/logger");
const { BASE_URL, IS_PRODUCTION } = require("./config");

const log = createLogger("melhorenvio.health");

// authHeaders() lança se o token não estiver configurado — aqui a gente quer
// reportar isso como estado, não como exceção. Resolve o header sem propagar.
function tryAuthHeaders() {
  try {
    // require local pra não congelar config no topo (env pode mudar em teste)
    const { authHeaders } = require("./config");
    return { headers: authHeaders(), error: null };
  } catch (err) {
    return { headers: null, error: err.message };
  }
}

async function meGet(path, headers) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && (data.message || data.error)
        ? data.message || data.error
        : `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Preflight da integração Melhor Envio: confirma ambiente, validade do token e
 * saldo na carteira ANTES de arriscar a emissão de uma etiqueta real.
 *
 * Não lança: devolve sempre um objeto de diagnóstico (cada check com ok/erro),
 * pra alimentar o painel admin de pagamentos.
 *
 * @returns {Promise<Object>}
 */
async function checkHealth() {
  const out = {
    environment: IS_PRODUCTION ? "production" : "sandbox",
    base_url: BASE_URL,
    token_configured: false,
    token_valid: null,
    account: null,
    balance: null,
    balance_currency: "BRL",
    ok: false,
    checks: { token: null, account: null, balance: null },
    error: null,
  };

  const { headers, error: tokenErr } = tryAuthHeaders();
  if (!headers) {
    out.checks.token = { ok: false, error: tokenErr };
    out.error = tokenErr;
    return out;
  }
  out.token_configured = true;

  // /me — confirma que o token autentica e diz qual conta ME está em uso.
  try {
    const me = await meGet("/me", headers);
    out.token_valid = true;
    out.checks.token = { ok: true };
    out.account = {
      id: me?.id ?? null,
      name: me?.firstname
        ? `${me.firstname} ${me.lastname || ""}`.trim()
        : me?.name || null,
      email: me?.email ?? null,
    };
    out.checks.account = { ok: true };
  } catch (err) {
    out.token_valid = false;
    const reason =
      err.status === 401 || err.status === 403
        ? "Token inválido ou sem permissão (verifique escopos/expiração)"
        : err.message;
    out.checks.token = { ok: false, error: reason, status: err.status || null };
    out.checks.account = { ok: false, error: reason };
    out.error = reason;
    log.warn("health.me_fail", { status: err.status, message: err.message });
    return out; // sem token válido não adianta checar saldo
  }

  // /me/balance — saldo disponível para pagar etiquetas. Em produção, saldo
  // zero faz o checkout da etiqueta falhar.
  try {
    const bal = await meGet("/me/balance", headers);
    const balance = Number(bal?.balance ?? bal?.value ?? 0);
    out.balance = Number.isFinite(balance) ? balance : 0;
    out.checks.balance = {
      ok: true,
      sufficient: out.balance > 0,
      warning:
        IS_PRODUCTION && out.balance <= 0
          ? "Saldo zerado — a emissão de etiqueta vai falhar até adicionar saldo na carteira ME"
          : null,
    };
  } catch (err) {
    out.checks.balance = { ok: false, error: err.message, status: err.status || null };
    log.warn("health.balance_fail", { status: err.status, message: err.message });
  }

  out.ok = out.token_valid === true;
  return out;
}

module.exports = { checkHealth };
