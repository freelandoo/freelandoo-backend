// Registra os espaços publicitários COMERCIAIS da Freelandoo Arena (mig 286).
//
//   node scripts/arena-placements.js                     → SIMULA (mostra o que mudaria)
//   node scripts/arena-placements.js --apply             → grava
//   node scripts/arena-placements.js --env br-sp --apply → só um ambiente
//   node scripts/arena-placements.js --file outro.json
//
// O arquivo padrão é gerado no repositório freelandoo-arena por
// `npm run ads:placements` (mesmo gerador do jogo; classes de slot explícitas).
// Usa DATABASE_URL. ⚠️ Com o .env do backend isso é PRODUÇÃO: simule primeiro.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { syncPlacements } = require("../src/services/ArenaAdSync");

async function main() {
  const args = process.argv.slice(2);
  const val = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : null);
  const file = val("--file") ? path.resolve(val("--file")) : path.join(__dirname, "..", "src", "databases", "seeds", "arena-placements.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const out = await syncPlacements(client, doc, { apply: args.includes("--apply"), environments: val("--env") ? [val("--env")] : null });
    if (!out.ok) {
      console.error("Documento inválido:\n  - " + out.errors.slice(0, 30).join("\n  - "));
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
