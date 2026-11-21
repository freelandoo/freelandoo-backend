// src/utils/malvoClient.js
//
// Cliente da API da Malvo (Open Finance, mig 462). Só servidor.
//
// Autenticação em duas etapas (docs.malvo.io/concepts/authentication):
//   clientId + clientSecret → POST /auth → apiKey (2 h) → header X-API-KEY.
// A apiKey fica em memória e é renovada antes de expirar (1h50); num 401/403
// das rotas de dados ela é jogada fora e o pedido é refeito UMA vez.
//
// ⚠️ O clientSecret e a apiKey NUNCA saem do servidor. O navegador só recebe o
// connectToken (30 min) que dirige o widget.
//
// Variáveis: MALVO_CLIENT_ID, MALVO_CLIENT_SECRET, MALVO_API_BASE (padrão
// https://api.malvo.io), MALVO_ENV (sandbox|production — só para a tela
// mostrar os conectores de teste) e MALVO_WEBHOOK_SECRET (o `whsec_…`).
const { createLogger } = require("./logger");

const log = createLogger("malvoClient");

const API_KEY_TTL_MS = 110 * 60 * 1000;
const TIMEOUT_MS = 15000;

let cached = { key: null, at: 0 };

function config() {
  return {
    base: String(process.env.MALVO_API_BASE || "https://api.malvo.io").replace(/\/$/, ""),
    clientId: String(process.env.MALVO_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.MALVO_CLIENT_SECRET || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.clientId && c.clientSecret);
}

function isSandbox() {
  return String(process.env.MALVO_ENV || "").toLowerCase() === "sandbox";
}

class MalvoError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = "MalvoError";
    this.status = status ?? null;
    this.code = code ?? null;
    this.body = body ?? null;
  }
}

async function rawRequest(method, path, { body, apiKey, timeoutMs = TIMEOUT_MS } = {}) {
  const { base } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (apiKey) headers["X-API-KEY"] = apiKey;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function getApiKey({ force = false } = {}) {
  if (!force && cached.key && Date.now() - cached.at < API_KEY_TTL_MS) return cached.key;
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret) throw new MalvoError("Malvo não configurada (MALVO_CLIENT_ID/SECRET)", { status: 503 });
  const r = await rawRequest("POST", "/auth", { body: { clientId, clientSecret } });
  if (r.status !== 200 || !r.json?.apiKey) {
    throw new MalvoError("Falha ao autenticar na Malvo", { status: r.status, code: r.json?.code, body: r.json });
  }
  cached = { key: r.json.apiKey, at: Date.now() };
  return cached.key;
}

/**
 * Chamada autenticada. 401/403 (apiKey vencida — o /connect_token responde 403)
 * renovam a chave e repetem UMA vez; 429 espera e repete uma vez.
 */
async function request(method, path, body) {
  let apiKey = await getApiKey();
  let r = await rawRequest(method, path, { body, apiKey });
  if (r.status === 401 || r.status === 403) {
    apiKey = await getApiKey({ force: true });
    r = await rawRequest(method, path, { body, apiKey });
  }
  if (r.status === 429) {
    await new Promise((ok) => setTimeout(ok, 1500));
    r = await rawRequest(method, path, { body, apiKey });
  }
  if (r.status >= 400) {
    const msg = r.json?.message || r.json?.error || `Malvo respondeu ${r.status}`;
    log.warn("malvo.http_error", { method, path: path.split("?")[0], status: r.status, code: r.json?.code });
    throw new MalvoError(msg, { status: r.status, code: r.json?.code || r.json?.codeDescription, body: r.json });
  }
  return r.json;
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

const MalvoClient = {
  isConfigured,
  isSandbox,
  MalvoError,

  /** Token de 30 min para o widget. Com `itemId`, abre em modo de atualização. */
  async createConnectToken({ clientUserId, itemId, webhookUrl } = {}) {
    // avoidDuplicates: o mesmo banco da mesma pessoa reaproveita o Item em vez
    // de criar outro (Item novo = conexão nova = cobrança nova).
    const options = { avoidDuplicates: true };
    if (clientUserId) options.clientUserId = String(clientUserId);
    if (webhookUrl) options.webhookUrl = webhookUrl;
    const body = { options };
    if (itemId) body.itemId = itemId;
    const r = await request("POST", "/connect_token", body);
    return r?.accessToken || null;
  },

  /**
   * Cria um Item direto pela API. Em produção o Item nasce pelo widget (a
   * pessoa autoriza no banco); este caminho existe para o e2e no sandbox
   * (conector 7 + CPF sintético da doc).
   */
  createItem({ connectorId, parameters, clientUserId }) {
    return request("POST", "/items", { connectorId, parameters, clientUserId, avoidDuplicates: false });
  },

  getItem(itemId) {
    return request("GET", `/items/${encodeURIComponent(itemId)}`);
  },

  /** Reconectar pedido pelo usuário: força um consentimento novo (é cobrado). */
  reconsentItem(itemId) {
    return request("PATCH", `/items/${encodeURIComponent(itemId)}`, { reconsent: true });
  },

  /** Revoga o consentimento e apaga o Item na Malvo. 404 = já não existe (ok). */
  async deleteItem(itemId) {
    try {
      await request("DELETE", `/items/${encodeURIComponent(itemId)}`);
      return { ok: true };
    } catch (e) {
      if (e.status === 404) return { ok: true, already: true };
      throw e;
    }
  },

  /** Liga/desliga o auto-sync do Item. Item sem sync no mês não é cobrado. */
  // 1 sincronização por dia: a Carteira não precisa de mais, e a Malvo cobra
  // por item atualizado no MÊS, não por sincronização.
  setAutoSync(itemId, enabled) {
    return request(
      "PATCH",
      `/items/${encodeURIComponent(itemId)}/auto-sync`,
      enabled ? { autoSyncEnabled: true, autoSyncFrequency: 1 } : { autoSyncEnabled: false }
    );
  },

  listAccounts(itemId) {
    return request("GET", `/accounts${qs({ itemId })}`).then((r) => r?.results || []);
  },

  /** Todas as páginas (cursor `next`, 500 por página) a partir de `dateFrom`. */
  async listTransactions(accountId, { dateFrom, maxPages = 20 } = {}) {
    const out = [];
    let path = `/v2/transactions${qs({ accountId, dateFrom })}`;
    for (let page = 0; page < maxPages && path; page++) {
      const r = await request("GET", path);
      for (const t of r?.results || []) out.push(t);
      if (!r?.next) break;
      // `next` traz só accountId e after: os filtros da consulta inicial têm
      // que ser reaplicados em toda página (regra da doc).
      const nextQs = String(r.next).includes("?") ? String(r.next).split("?")[1] : String(r.next);
      const params = new URLSearchParams(nextQs);
      if (dateFrom) params.set("dateFrom", dateFrom);
      params.set("accountId", accountId);
      path = `/v2/transactions?${params.toString()}`;
    }
    return out;
  },

  listBills(accountId) {
    return request("GET", `/bills${qs({ accountId })}`).then((r) => r?.results || []);
  },

  /** Só para testes: zera a apiKey em memória. */
  _resetCache() {
    cached = { key: null, at: 0 };
  },
};

module.exports = MalvoClient;
