// Wrapper histórico para rodar migrations manualmente contra o banco
// remoto. Hoje compartilha a mesma lógica do runner do prestart — então
// roda contra qualquer DATABASE_URL apontada pelo .env corrente.
//
// Uso típico: `node migrate-remote.js` apontando o .env para staging/prod.
// Falha aborta com exit 1.

require("dotenv").config();

const { runMigrations } = require("./src/migrations/runner");
const { createLogger } = require("./src/utils/logger");

const log = createLogger("migrate-remote");

runMigrations()
  .then((result) => {
    log.info("migrate-remote.done", result);
    process.exit(0);
  })
  .catch((err) => {
    log.error("migrate-remote.fatal", { message: err?.message });
    process.exit(1);
  });
