// Entry point do runner de migrations.
//
// Chamado em dois caminhos:
//   1. `prestart` em package.json — antes do `npm start` em produção.
//   2. `npm run migrate` — execução explícita por humano ou pipeline.
//
// Falha ABORTA com exit 1, então o `npm start` não dispara com schema
// inconsistente. Lógica completa em src/migrations/runner.js.
//
// ⚠️ SÃO DOIS BANCOS AGORA. O quente (a plataforma) roda sempre. O frio (o
// catálogo de leads) roda SÓ quando `DATABASE_URL_COLD` existe e aponta para
// outro lugar — sem a variável, o passo é pulado e nada muda. É isso que torna
// o deploy deste código seguro ANTES de o banco frio existir, e torna apagar a
// variável um rollback sem deploy.

require("dotenv").config();

const {
  runMigrations,
  COLD_LOCK_ID,
  COLD_MIGRATIONS_DIR,
} = require("./src/migrations/runner");
const { createLogger } = require("./src/utils/logger");

const log = createLogger("migrations");

async function main() {
  // 1) plataforma — sempre.
  const quente = await runMigrations();
  log.info("migrations.done", { banco: "quente", ...quente });

  // 2) catálogo de leads — só se ele for mesmo um banco à parte.
  const cold = process.env.DATABASE_URL_COLD;
  if (!cold) {
    log.info("migrations.cold_skipped", { motivo: "DATABASE_URL_COLD ausente" });
    return;
  }
  // ⚠️ Apontar o frio para o MESMO banco não separa nada e ainda faria este
  // runner criar um segundo `schema_migrations` sobre as mesmas tabelas.
  // Recusar em voz alta é melhor que rodar e parecer que deu certo.
  if (cold === process.env.DATABASE_URL) {
    log.warn("migrations.cold_skipped", {
      motivo: "DATABASE_URL_COLD é igual a DATABASE_URL — não há separação",
    });
    return;
  }

  const coldPool = require("./src/databases/cold");
  const frio = await runMigrations({
    pool: coldPool,
    dir: COLD_MIGRATIONS_DIR,
    lockId: COLD_LOCK_ID,
    label: "frio",
  });
  log.info("migrations.done", { banco: "frio", ...frio });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("migrations.fatal", { message: err?.message });
    process.exit(1);
  });
