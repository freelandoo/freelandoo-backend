// Registra os postes de conquista da Freelandoo Arena (mig 282).
//
//   node scripts/arena-posts.js                         → SIMULA (mostra o que mudaria)
//   node scripts/arena-posts.js --apply                 → grava (postes NÃO competitivos)
//   node scripts/arena-posts.js --env br-sp --apply     → só um ambiente
//   node scripts/arena-posts.js --competitive --apply   → liga a pontuação (decisão do proprietário)
//   node scripts/arena-posts.js --file outro.json
//
// O arquivo padrão é gerado no repositório freelandoo-arena por
// `npm run world:posts` (mesmo gerador do jogo).
// Usa DATABASE_URL. ⚠️ Com o .env do backend isso é PRODUÇÃO: rodar sem
// --apply primeiro, sempre. As avenidas ainda são RASCUNHO (decisão A
// pendente): não ligar --competitive em produção sem aprovação.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { syncPosts } = require("../src/services/ArenaPostSync");

async function main() {
  const args = process.argv.slice(2);
  const val = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const file = val("--file") ? path.resolve(val("--file")) : path.join(__dirname, "..", "src", "databases", "seeds", "arena-posts.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const env = val("--env");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const out = await syncPosts(client, doc, {
      apply: args.includes("--apply"),
      environments: env ? [env] : null,
      competitive: args.includes("--competitive"),
    });
    if (!out.ok) {
      console.error("Documento inválido:\n  - " + out.errors.join("\n  - "));
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
