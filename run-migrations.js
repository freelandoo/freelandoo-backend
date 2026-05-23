// Entry point do runner de migrations.
//
// Chamado em dois caminhos:
//   1. `prestart` em package.json — antes do `npm start` em produção.
//   2. `npm run migrate` — execução explícita por humano ou pipeline.
//
// Falha ABORTA com exit 1, então o `npm start` não dispara com schema
// inconsistente. Lógica completa em src/migrations/runner.js.

require("dotenv").config();

const { runMigrations } = require("./src/migrations/runner");
const { createLogger } = require("./src/utils/logger");

const log = createLogger("migrations");

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("migrations.fatal", { message: err?.message });
    process.exit(1);
  });
