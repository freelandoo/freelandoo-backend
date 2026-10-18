// Importa campanhas e criativos APROVADOS da Freelandoo Arena (mig 286).
//
//   node scripts/arena-ads.js            → SIMULA
//   node scripts/arena-ads.js --apply    → grava (campanha nova nasce rascunho + aprovação pendente)
//   node scripts/arena-ads.js --file outro.json
//
// O documento vem de `npm run ads:ingest` no repositório freelandoo-arena, que
// valida o formato REAL dos arquivos (assinatura, dimensões, duração) e só
// aceita criativo com `approvedBy`. Versão de criativo é imutável.
// Aprovar campanha, agendar, ativar e reservar espaço: scripts/arena-ads-ops.js.
// Usa DATABASE_URL. ⚠️ Com o .env do backend isso é PRODUÇÃO: simule primeiro.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { syncAds } = require("../src/services/ArenaAdSync");

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--file");
  const file = fi >= 0 ? path.resolve(args[fi + 1]) : path.join(__dirname, "..", "src", "databases", "seeds", "arena-ads.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const out = await syncAds(client, doc, { apply: args.includes("--apply") });
    if (!out.ok) {
      console.error("Recusado:\n  - " + out.errors.join("\n  - "));
      process.exitCode = 1;
      return;
    }
    console.log(`${args.includes("--apply") ? "APLICADO" : "SIMULAÇÃO (nada gravado)"}:`, out.summary);
  } finally {
    await client.end();
  }
}
main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
