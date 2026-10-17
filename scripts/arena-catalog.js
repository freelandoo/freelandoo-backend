// Aplica o catálogo da Freelandoo Arena.
//
//   node scripts/arena-catalog.js            → SIMULA (valida e mostra o que mudaria)
//   node scripts/arena-catalog.js --apply    → grava
//   node scripts/arena-catalog.js --file outro.json
//
// Usa DATABASE_URL. ⚠️ Com o .env do backend isso é PRODUÇÃO: rodar sem
// --apply primeiro, sempre.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { syncCatalog } = require("../src/services/ArenaCatalogSync");

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const fi = args.indexOf("--file");
  const file = fi >= 0 ? path.resolve(args[fi + 1]) : path.join(__dirname, "..", "src", "databases", "seeds", "arena-catalog.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const out = await syncCatalog(client, doc, { apply });
    if (!out.ok) {
      console.error("Catálogo inválido:\n  - " + out.errors.join("\n  - "));
      process.exitCode = 1;
      return;
    }
    console.log(`${apply ? "APLICADO" : "SIMULAÇÃO (nada gravado)"}:`, out.summary);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
