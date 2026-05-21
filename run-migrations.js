// Runner de migrations executado automaticamente no boot via `prestart`
// (package.json) — antes de `node index.js`. No Railway o CMD é `npm start`,
// e o npm roda `prestart` antes de `start`.
//
// Usa o MESMO pool da aplicação (src/databases) — então conecta exatamente
// como o servidor conecta em produção (SSL etc. resolvidos lá).
//
// Cada migration roda na sua própria transação. Erro em uma migration é
// logado mas NÃO derruba o boot: o processo sempre sai com código 0, senão
// o `npm start` abortaria e o servidor nem subiria.
//
// Para rodar manualmente contra o banco remoto: `node migrate-remote.js`.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("./src/databases");
const { createLogger } = require("./src/utils/logger");

const log = createLogger("migrations");
const MIGRATIONS_DIR = path.join(__dirname, "src", "databases", "migrations");

async function runMigrations() {
  let files = [];
  try {
    files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    log.error("migrations.dir_error", { message: err.message });
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Migrations podem ser mais lentas que o statement_timeout do pool.
      await client.query("SET LOCAL statement_timeout = 0");
      await client.query(sql);
      await client.query("COMMIT");
      ok += 1;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* conexão já pode estar inutilizável */
      }
      failed += 1;
      log.error("migration.failed", { file, message: err.message });
    } finally {
      client.release();
    }
  }
  log.info("migrations.done", { total: files.length, ok, failed });
}

runMigrations()
  .catch((err) => log.error("migrations.fatal", { message: err?.message }))
  .finally(() => {
    // Sempre sai com 0 — uma migration com erro não pode impedir o boot.
    process.exit(0);
  });
