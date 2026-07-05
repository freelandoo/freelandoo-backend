// src/services/AtendimentoIaProvisionService.js
// Provisionamento push Freelandoo → bot de atendimento (pjcodeworks-agent).
//
// Contrato (docs/API_ATENDIMENTO_IA_PROVISION.md):
//   POST {ATENDIMENTO_BOT_URL}/freelandoo/provision    (upsert por external_id)
//   POST {ATENDIMENTO_BOT_URL}/freelandoo/deprovision  { external_id }
//   GET  {ATENDIMENTO_BOT_URL}/freelandoo/usage/:external_id
// Header de auth: x-provision-secret = ATENDIMENTO_BOT_SECRET.
//
// Como o token em claro NUNCA é persistido (só o hash), cada tentativa de
// provisionar RE-CUNHA as duas conexões gerenciadas (revoga as anteriores) e
// envia os tokens novos no payload — o bot faz upsert, sobrescrever é seguro.
// Re-push de config/ciclo NÃO re-envia tokens (campos omitidos = manter).
//
// NUNCA logar token (nem em meta de runWithLogs).
const crypto = require("crypto");
const pool = require("../databases");
const AtendimentoIaStorage = require("../storages/AtendimentoIaStorage");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ApiConnectionService = require("./ApiConnectionService");
const { createLogger } = require("../utils/logger");

const log = createLogger("AtendimentoIaProvisionService");

const MANAGED_BY = "atendimento_ia";
// Backoff entre tentativas (s): 1min → 5min → 30min → 2h → 6h (repete a última).
const BACKOFF_S = [60, 300, 1800, 7200, 21600];
const MAX_ATTEMPTS = 8;
const SWEEP_INTERVAL_MS = 30 * 1000;
const USAGE_CACHE_MS = 60 * 1000;

let sweeperTimer = null;
const usageCache = new Map(); // external_id -> { at, data }

function botUrl() {
  return String(process.env.ATENDIMENTO_BOT_URL || "").replace(/\/+$/, "");
}
function botSecret() {
  return process.env.ATENDIMENTO_BOT_SECRET || "";
}
function configured() {
  return !!(botUrl() && botSecret());
}

async function botFetch(method, path, body) {
  const res = await fetch(`${botUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-provision-secret": botSecret(),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text?.slice(0, 200) }; }
  if (!res.ok) {
    const msg = data?.error || `Bot respondeu HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Cunha uma conexão gerenciada e devolve { row, token } — token só em memória.
async function mintManagedConnection(id_user, kind, name) {
  const token = ApiConnectionService.KIND_TOKEN_PREFIX[kind] + crypto.randomBytes(24).toString("base64url");
  const webhook_secret = "flwh_" + crypto.randomBytes(24).toString("base64url");
  const row = await ApiConnectionStorage.create(pool, {
    id_user,
    name,
    token_hash: ApiConnectionService.sha256Hex(token),
    token_prefix: token.slice(0, 14),
    scope_personal: false,
    webhook_secret,
    kind,
    managed_by: MANAGED_BY,
  });
  if (!row) throw new Error("Falha ao cunhar conexão gerenciada");
  return { row, token };
}

class AtendimentoIaProvisionService {
  static get MANAGED_BY() { return MANAGED_BY; }
  static isConfigured() { return configured(); }

  // Revoga as conexões gerenciadas atuais da assinatura (idempotente).
  static async revokeConnections(sub) {
    for (const id of [sub.id_connection_atendimento, sub.id_connection_data]) {
      if (id) await ApiConnectionStorage.revokeManaged(pool, id).catch(() => null);
    }
  }

  // Push COMPLETO (com tokens re-cunhados). Usado na ativação e no retry.
  static async pushProvision(id_sub) {
    const sub = await AtendimentoIaStorage.getSubById(pool, id_sub);
    if (!sub) return { error: "sub_not_found" };
    if (!["active", "past_due"].includes(sub.status)) return { skipped: true, reason: "sub_not_live" };
    if (!configured()) {
      await AtendimentoIaStorage.setProvisioning(pool, sub.id_sub, {
        status: "failed",
        attempts: (sub.provision_attempts || 0) + 1,
        next_attempt_at: new Date(Date.now() + 21600 * 1000),
        last_error: "ATENDIMENTO_BOT_URL/SECRET não configurados",
      });
      log.warn("provision.not_configured", { id_sub: sub.id_sub });
      return { error: "not_configured" };
    }

    const userRow = await pool.query(
      `SELECT username FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
      [sub.id_user]
    );
    const username = userRow.rows[0]?.username || String(sub.id_user).slice(0, 8);

    try {
      // Re-cunha os tokens (revoga os anteriores) — não guardamos token em claro.
      await this.revokeConnections(sub);
      const atd = await mintManagedConnection(sub.id_user, "atendimento", "Atendimento IA (bot)");
      const dat = await mintManagedConnection(sub.id_user, "data", "Atendimento IA (dados)");
      await AtendimentoIaStorage.setConnections(pool, sub.id_sub, {
        id_connection_atendimento: atd.row.id_connection,
        id_connection_data: dat.row.id_connection,
      });

      await botFetch("POST", "/freelandoo/provision", {
        external_id: String(sub.id_user),
        label: username,
        token_atendimento: atd.token,
        token_data: dat.token,
        token_limit_monthly: Number(sub.token_limit_monthly),
        cycle_start: sub.current_period_start || sub.activated_at || new Date().toISOString(),
        config: sub.config || {},
      });

      await AtendimentoIaStorage.setProvisioning(pool, sub.id_sub, {
        status: "provisioned",
        attempts: (sub.provision_attempts || 0) + 1,
        next_attempt_at: null,
        last_error: null,
      });
      log.info("provision.ok", { id_sub: sub.id_sub });
      return { ok: true };
    } catch (err) {
      const attempts = (sub.provision_attempts || 0) + 1;
      const backoff = BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)];
      const exhausted = attempts >= MAX_ATTEMPTS;
      await AtendimentoIaStorage.setProvisioning(pool, sub.id_sub, {
        status: "failed",
        attempts,
        // Esgotou as tentativas: para de agendar; admin re-provisiona na mão.
        next_attempt_at: exhausted ? null : new Date(Date.now() + backoff * 1000),
        last_error: err.message,
      });
      log.error("provision.fail", { id_sub: sub.id_sub, attempts, error: err.message });
      return { error: err.message };
    }
  }

  // Re-push leve de config/ciclo (SEM tokens). Best-effort; se o bot estiver
  // fora, marca failed pro sweeper re-provisionar (com tokens novos) depois.
  static async pushConfig(id_sub) {
    const sub = await AtendimentoIaStorage.getSubById(pool, id_sub);
    if (!sub || !["active", "past_due"].includes(sub.status)) return { skipped: true };
    if (!configured()) return { error: "not_configured" };
    try {
      await botFetch("POST", "/freelandoo/provision", {
        external_id: String(sub.id_user),
        token_limit_monthly: Number(sub.token_limit_monthly),
        cycle_start: sub.current_period_start || sub.activated_at || null,
        config: sub.config || {},
      });
      return { ok: true };
    } catch (err) {
      log.warn("pushConfig.fail", { id_sub: sub.id_sub, error: err.message });
      await AtendimentoIaStorage.setProvisioning(pool, sub.id_sub, {
        status: "failed",
        attempts: sub.provision_attempts || 0,
        next_attempt_at: new Date(Date.now() + 60 * 1000),
        last_error: `config: ${err.message}`,
      });
      return { error: err.message };
    }
  }

  static async pushDeprovision(sub) {
    if (!configured()) return { error: "not_configured" };
    try {
      await botFetch("POST", "/freelandoo/deprovision", { external_id: String(sub.id_user) });
      await AtendimentoIaStorage.setProvisioning(pool, sub.id_sub, {
        status: "deprovisioned",
        attempts: sub.provision_attempts || 0,
        next_attempt_at: null,
        last_error: null,
      });
      return { ok: true };
    } catch (err) {
      // Best-effort: os tokens já foram revogados — o bot morre com 401 de
      // qualquer jeito. Só registra.
      log.warn("deprovision.fail", { id_sub: sub.id_sub, error: err.message });
      await AtendimentoIaStorage.setProvisioning(pool, sub.id_sub, {
        status: "deprovisioned",
        attempts: sub.provision_attempts || 0,
        next_attempt_at: null,
        last_error: `deprovision: ${err.message}`,
      });
      return { error: err.message };
    }
  }

  // Uso do ciclo direto do bot (cache 60s; null quando indisponível).
  static async fetchUsage(id_user) {
    if (!configured()) return null;
    const key = String(id_user);
    const cached = usageCache.get(key);
    if (cached && Date.now() - cached.at < USAGE_CACHE_MS) return cached.data;
    try {
      const data = await botFetch("GET", `/freelandoo/usage/${encodeURIComponent(key)}`);
      usageCache.set(key, { at: Date.now(), data });
      return data;
    } catch (err) {
      log.warn("fetchUsage.fail", { error: err.message });
      usageCache.set(key, { at: Date.now(), data: null });
      return null;
    }
  }

  // Agenda um provisionamento imediato (o sweeper pega no próximo tick).
  static async scheduleProvision(id_sub) {
    await AtendimentoIaStorage.setProvisioning(pool, id_sub, {
      status: "pending",
      attempts: null,
      next_attempt_at: new Date(),
      last_error: null,
    });
    // Tenta já, sem bloquear o chamador (webhook).
    setImmediate(() => this.pushProvision(id_sub).catch(() => {}));
  }

  // Sweeper no boot: reprocessa provisionamentos devidos (bot fora do ar etc.).
  static startSweeper() {
    if (sweeperTimer) return;
    sweeperTimer = setInterval(async () => {
      try {
        const due = await AtendimentoIaStorage.listDueForProvision(pool, 5);
        for (const sub of due) {
          await this.pushProvision(sub.id_sub);
        }
      } catch (err) {
        log.error("sweeper.fail", { error: err.message });
      }
    }, SWEEP_INTERVAL_MS);
    if (sweeperTimer.unref) sweeperTimer.unref();
    log.info("sweeper.started", { interval_ms: SWEEP_INTERVAL_MS });
  }
}

module.exports = AtendimentoIaProvisionService;
