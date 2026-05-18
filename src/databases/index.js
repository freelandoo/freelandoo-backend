const { Pool } = require("pg");
const { createLogger } = require("../utils/logger");

const dbLog = createLogger("db");

const useSsl = process.env.DATABASE_SSL === "true";

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

const pool = new Pool({
  connectionString: normalizeConnectionString(process.env.DATABASE_URL),
  max: intFromEnv("DATABASE_POOL_MAX", 25),
  min: intFromEnv("DATABASE_POOL_MIN", 2),
  idleTimeoutMillis: intFromEnv("DATABASE_POOL_IDLE_MS", 30_000),
  connectionTimeoutMillis: intFromEnv("DATABASE_POOL_CONN_TIMEOUT_MS", 5_000),
  statement_timeout: intFromEnv("DATABASE_STATEMENT_TIMEOUT_MS", 8_000),
  query_timeout: intFromEnv("DATABASE_QUERY_TIMEOUT_MS", 8_000),
  ...(useSsl
    ? {
        ssl: {
          rejectUnauthorized:
            process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
        },
      }
    : {}),
});

pool.on("error", (err) => {
  dbLog.error("postgres.pool.error", { message: err?.message });
});

dbLog.info("postgres.pool.configured", {
  ssl: useSsl,
  max: pool.options.max,
  min: pool.options.min,
  idleTimeoutMillis: pool.options.idleTimeoutMillis,
  connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
});

module.exports = pool;
