/**
 * A FÁBRICA DE POOL — fonte única da configuração de conexão.
 *
 * Existe porque agora há DOIS bancos (o quente, em `./index`, e o frio dos
 * leads, em `./cold`). Escrita duas vezes, a configuração divergiria na
 * primeira mudança de SSL ou de timeout — e a divergência só apareceria no
 * banco que ninguém olhou.
 *
 * O que muda entre os dois é declarado por parâmetro (nome do log, teto de
 * conexões, timeout); o resto — SSL, normalização da URL, leitura de env — é
 * igual por construção.
 */
const { Pool } = require("pg");
const { createLogger } = require("../utils/logger");

const useSsl = process.env.DATABASE_SSL === "true";

/**
 * ⚠️ Com `DATABASE_SSL=true` o `sslmode` da URL é REMOVIDO de propósito.
 * O `sslmode=require` da connection string VENCE o objeto `ssl` do pg, e a
 * conexão morre com "self-signed certificate in certificate chain" — mesmo
 * com `rejectUnauthorized: false` configurado ali do lado.
 */
function normalizeConnectionString(connectionString) {
  if (!useSsl || !connectionString) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    return connectionString;
  }
}

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createPool({
  name,
  connectionString,
  maxEnv = "DATABASE_POOL_MAX",
  maxDefault = 25,
  timeoutEnv = "DATABASE_STATEMENT_TIMEOUT_MS",
  timeoutDefault = 8_000,
}) {
  const log = createLogger(name);
  const timeout = intFromEnv(timeoutEnv, timeoutDefault);

  const pool = new Pool({
    connectionString: normalizeConnectionString(connectionString),
    max: intFromEnv(maxEnv, maxDefault),
    min: intFromEnv("DATABASE_POOL_MIN", 2),
    idleTimeoutMillis: intFromEnv("DATABASE_POOL_IDLE_MS", 30_000),
    connectionTimeoutMillis: intFromEnv("DATABASE_POOL_CONN_TIMEOUT_MS", 5_000),
    statement_timeout: timeout,
    query_timeout: timeout,
    ...(useSsl
      ? {
          ssl: {
            rejectUnauthorized:
              process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
          },
        }
      : {}),
  });

  // ⚠️ Sem este handler, um erro de conexão ocioso derruba o processo inteiro
  // (o `pg` emite 'error' no pool, e 'error' sem ouvinte é exceção não tratada).
  pool.on("error", (err) => {
    log.error("postgres.pool.error", { message: err?.message });
  });

  log.info("postgres.pool.configured", {
    ssl: useSsl,
    max: pool.options.max,
    min: pool.options.min,
    statementTimeoutMs: timeout,
    idleTimeoutMillis: pool.options.idleTimeoutMillis,
    connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
  });

  return pool;
}

module.exports = { createPool, normalizeConnectionString, intFromEnv };
