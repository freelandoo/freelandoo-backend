// Lógica do runner de migrations — usada pelo prestart (run-migrations.js),
// pelo runner manual (migrate-remote.js) e pelo `npm run migrate:status`.
//
// Garantias:
//   - Tabela `schema_migrations` registra cada arquivo aplicado + SHA-256.
//   - `pg_advisory_lock` serializa execuções concorrentes (duas réplicas
//     subindo ao mesmo tempo não rodam migrations em paralelo).
//   - Checksum divergente em migration já aplicada → erro fatal.
//   - Bootstrap silencioso na primeira execução em banco já provisionado.
//   - Cada migration roda em transação própria; erro aborta o processo.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../databases");
const { createLogger } = require("../utils/logger");

const log = createLogger("migrations");
const MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "databases",
  "migrations"
);
const LOCK_ID = 919282;

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function ensureSchemaTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename          TEXT        PRIMARY KEY,
      checksum          TEXT        NOT NULL,
      executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_time_ms INTEGER     NOT NULL DEFAULT 0,
      success           BOOLEAN     NOT NULL DEFAULT TRUE,
      error_message     TEXT
    )
  `);
}

async function getAppliedMap(client) {
  const { rows } = await client.query(
    "SELECT filename, checksum FROM schema_migrations WHERE success = TRUE"
  );
  const map = new Map();
  for (const row of rows) map.set(row.filename, row.checksum);
  return map;
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function readMigration(file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  return { sql, checksum: sha256(sql) };
}

async function bootstrapBackfill(client, files) {
  log.warn("migrations.bootstrap", {
    msg:
      "schema_migrations vazia — marcando todas as migrations existentes " +
      "como já aplicadas (primeiro boot do novo runner).",
    count: files.length,
  });
  for (const file of files) {
    const { checksum } = readMigration(file);
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum, execution_time_ms, success)
       VALUES ($1, $2, 0, TRUE)
       ON CONFLICT (filename) DO NOTHING`,
      [file, checksum]
    );
  }
}

async function applyMigration(client, file) {
  const { sql, checksum } = readMigration(file);
  const start = Date.now();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations
         (filename, checksum, execution_time_ms, success, error_message)
       VALUES ($1, $2, $3, TRUE, NULL)
       ON CONFLICT (filename) DO UPDATE
         SET checksum = EXCLUDED.checksum,
             executed_at = NOW(),
             execution_time_ms = EXCLUDED.execution_time_ms,
             success = TRUE,
             error_message = NULL`,
      [file, checksum, Date.now() - start]
    );
    await client.query("COMMIT");
    log.info("migration.applied", { file, ms: Date.now() - start });
    return { ok: true };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* conexão pode estar inutilizável */
    }
    try {
      await client.query(
        `INSERT INTO schema_migrations
           (filename, checksum, execution_time_ms, success, error_message)
         VALUES ($1, $2, $3, FALSE, $4)
         ON CONFLICT (filename) DO UPDATE
           SET checksum = EXCLUDED.checksum,
               executed_at = NOW(),
               execution_time_ms = EXCLUDED.execution_time_ms,
               success = FALSE,
               error_message = EXCLUDED.error_message`,
        [
          file,
          checksum,
          Date.now() - start,
          String(err.message || err).slice(0, 1000),
        ]
      );
    } catch (logErr) {
      log.error("migration.log_failed", { file, message: logErr.message });
    }
    log.error("migration.failed", { file, message: err.message });
    return { ok: false, error: err };
  }
}

async function runMigrations() {
  const client = await pool.connect();
  let acquired = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    acquired = true;
    log.info("migrations.lock_acquired", { lockId: LOCK_ID });

    await ensureSchemaTable(client);

    const files = listMigrationFiles();
    if (files.length === 0) {
      log.warn("migrations.empty_dir");
      return { total: 0, applied_now: 0, already_applied: 0 };
    }

    let applied = await getAppliedMap(client);

    if (applied.size === 0) {
      await bootstrapBackfill(client, files);
      applied = await getAppliedMap(client);
    }

    const pending = [];
    const mismatches = [];
    for (const file of files) {
      const { checksum } = readMigration(file);
      const existing = applied.get(file);
      if (!existing) {
        pending.push(file);
      } else if (existing !== checksum) {
        mismatches.push({ file, expected: existing, got: checksum });
      }
    }

    if (mismatches.length > 0) {
      log.error("migrations.checksum_mismatch", { files: mismatches });
      throw new Error(
        `Checksum divergente em ${mismatches.length} migration(s) já aplicada(s): ` +
          mismatches.map((m) => m.file).join(", ") +
          ". Migrations aplicadas não podem ser editadas — criar nova migration."
      );
    }

    for (const file of pending) {
      const { ok, error } = await applyMigration(client, file);
      if (!ok) {
        throw error;
      }
    }

    const result = {
      total: files.length,
      applied_now: pending.length,
      already_applied: files.length - pending.length,
    };
    log.info("migrations.done", result);
    return result;
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
      } catch (err) {
        log.error("migrations.unlock_failed", { message: err.message });
      }
    }
    client.release();
  }
}

async function listStatus() {
  const client = await pool.connect();
  try {
    await ensureSchemaTable(client);
    const applied = await getAppliedMap(client);
    const files = listMigrationFiles();
    const status = files.map((file) => {
      const { checksum } = readMigration(file);
      const existing = applied.get(file);
      if (!existing) return { file, state: "pending", checksum };
      if (existing !== checksum)
        return { file, state: "checksum_mismatch", expected: existing, got: checksum };
      return { file, state: "applied", checksum };
    });
    return status;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations, listStatus, LOCK_ID };
