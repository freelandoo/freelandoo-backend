const { Pool } = require("pg");
const { createLogger } = require("../utils/logger");

const dbLog = createLogger("db");

const useSsl = process.env.DATABASE_SSL === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
