/**
 * routeLog — middleware que persiste requisições/erros em arch_route_logs,
 * alimentando o Painel de Arquitetura (aba Logs).
 *
 * Princípios:
 *  - Fire-and-forget: NUNCA bloqueia ou derruba o request (insert assíncrono
 *    com .catch silencioso).
 *  - Foco em erro: por padrão persiste só status >= 400. Sucessos (2xx/3xx)
 *    entram por amostragem via ARCH_LOG_SUCCESS_SAMPLE (0..1, default 0).
 *  - Evita ruído e loops: pula /health, /storage, /webhooks e as próprias
 *    rotas do painel de logs.
 *
 * O detalhe do erro (message/stack) é lido de res.locals.archError, setado
 * pelo error handler global em app.js.
 */
const ArchitectureStorage = require("../storages/ArchitectureStorage");
const pool = require("../databases");
const { createLogger } = require("../utils/logger");

const log = createLogger("routeLog");

const SUCCESS_SAMPLE = (() => {
  const n = Number(process.env.ARCH_LOG_SUCCESS_SAMPLE);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
})();

// Status de erro "esperados" que NÃO viram log — são ruído, não bug do app, e
// afogam os erros reais no painel (e incham a tabela à toa). Default: 401
// (não-autenticado / token expirado, altíssimo volume e zero valor de debug).
// Ajustável via ARCH_LOG_SKIP_STATUSES="401,404" (vazio = não pula nenhum).
const SKIP_STATUSES = (() => {
  const raw = process.env.ARCH_LOG_SKIP_STATUSES;
  const list = (raw == null ? "401" : raw)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
  return new Set(list);
})();

// Caminhos que não geram log (ruído ou risco de loop).
const SKIP_PREFIXES = [
  "/health",
  "/storage",
  "/webhooks",
  "/admin/architecture/logs",
];

function shouldSkipPath(pathname) {
  return SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

function routeLog(req, res, next) {
  const start = Date.now();
  const pathname = (req.originalUrl || req.url || "").split("?")[0];

  if (req.method === "OPTIONS" || shouldSkipPath(pathname)) {
    return next();
  }

  res.on("finish", () => {
    const status = res.statusCode;
    const isError = status >= 400;

    // Erros esperados (ruído, ex: 401) não viram log.
    if (isError && SKIP_STATUSES.has(status)) {
      return;
    }

    // Decide se persiste: erros sempre; sucessos por amostragem.
    if (!isError && (SUCCESS_SAMPLE <= 0 || Math.random() > SUCCESS_SAMPLE)) {
      return;
    }

    const archError = res.locals && res.locals.archError;
    const entry = {
      request_id: req.requestId || null,
      method: req.method,
      path: pathname.slice(0, 500),
      route_pattern: ((req.baseUrl || "") + (req.route?.path || "")).slice(0, 500) || null,
      status_code: status,
      duration_ms: Date.now() - start,
      user_id: req.user?.id_user || null,
      ip: req.ip || null,
      error_message: archError?.message ? String(archError.message).slice(0, 1000) : null,
      error_stack: archError?.stack ? String(archError.stack).slice(0, 6000) : null,
      meta: {},
    };

    // Insert assíncrono e isolado — falha aqui nunca afeta o request.
    ArchitectureStorage.insertRouteLog(pool, entry).catch((err) => {
      log.warn("routeLog.insert_failed", { message: err?.message });
    });
  });

  next();
}

module.exports = routeLog;
