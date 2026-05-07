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

const pool = new Pool({
  connectionString: normalizeConnectionString(process.env.DATABASE_URL),
  ...(useSsl
    ? {
        ssl: {
          rejectUnauthorized:
            process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
        },
      }
    : {}),
});

dbLog.info("postgres.pool.configured", { ssl: useSsl });

module.exports = pool;
