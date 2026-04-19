/**
 * Logger simples (sem dependências extras).
 * Use LOG_LEVEL=debug|info|warn|error e NODE_ENV para o padrão.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevelFromEnv() {
  const env = String(process.env.LOG_LEVEL || "").toLowerCase();
  if (env === "debug" || env === "trace") return "debug";
  if (env === "warn") return "warn";
  if (env === "error") return "error";
  if (env === "info") return "info";
  if (process.env.NODE_ENV === "production") return "info";
  return "debug";
}

const MIN = minLevelFromEnv();

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[MIN];
}

function serializeMeta(meta) {
  if (meta === undefined) return "";
  if (meta instanceof Error) {
    return ` ${JSON.stringify({
      name: meta.name,
      message: meta.message,
      stack: meta.stack,
    })}`;
  }
  try {
    const s =
      typeof meta === "object" ? JSON.stringify(meta) : String(meta);
    return s ? ` ${s}` : "";
  } catch {
    return " [meta não serializável]";
  }
}

function write(level, scope, message, meta) {
  if (!shouldLog(level)) return;
  const line = `[${new Date().toISOString()}] [${scope}] [${level.toUpperCase()}] ${message}${serializeMeta(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function createLogger(scope) {
  return {
    debug: (message, meta) => write("debug", scope, message, meta),
    info: (message, meta) => write("info", scope, message, meta),
    warn: (message, meta) => write("warn", scope, message, meta),
    error: (message, meta) => write("error", scope, message, meta),
  };
}

/**
 * Envolve uma operação async com logs de início, sucesso, erro de negócio ou exceção.
 * Se o retorno tiver propriedade string `error`, registra warn em vez de ok.
 */
function runWithLogs(log, operation, metaFactory, fn) {
  let meta = {};
  try {
    meta =
      typeof metaFactory === "function" ? metaFactory() : metaFactory || {};
  } catch {
    meta = {};
  }
  log.info(`${operation}.start`, meta);
  return Promise.resolve()
    .then(fn)
    .then((result) => {
      if (
        result &&
        typeof result === "object" &&
        typeof result.error === "string" &&
        result.error
      ) {
        log.warn(`${operation}.business_error`, {
          ...meta,
          error: result.error,
        });
      } else {
        log.info(`${operation}.ok`, meta);
      }
      return result;
    })
    .catch((err) => {
      log.error(`${operation}.fail`, err);
      throw err;
    });
}

module.exports = { createLogger, runWithLogs };
