#!/usr/bin/env node
// scripts/dados-fetch-example.js
// Exemplo de consumo da API de Dados (/ext/v1/data). Somente-leitura.
// Uso:
//   DATA_TOKEN=flnd_data_xxx BASE_URL=https://api.freelandoo.com node scripts/dados-fetch-example.js
// Requer Node 18+ (fetch global).

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.DATA_TOKEN;

if (!TOKEN || !TOKEN.startsWith("flnd_data_")) {
  console.error("Defina DATA_TOKEN=flnd_data_... (gerado em Conexões de Dados no site).");
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`${BASE_URL}/ext/v1/data${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

(async () => {
  const me = await get("/me");
  console.log(`\n== Conta @${me.username} (nível ${me.level}, ${me.xp_total} XP) ==`);
  console.log("Contagens:", me.counts);

  const { profiles } = await get("/profiles");
  console.log(`\n== ${profiles.length} perfis ==`);
  for (const p of profiles) {
    const tipo = p.is_community ? "comunidade" : p.is_clan ? "clan" : p.is_user_account ? "conta" : "subperfil";
    console.log(`- [${tipo}] ${p.display_name} — nível ${p.level}, ${p.followers} seguidores`);
  }

  const { totals } = await get("/metrics");
  console.log(`\n== Totais: ${totals.followers} seguidores, ${totals.xp_total} XP ==\n`);
})().catch((err) => {
  console.error("Falhou:", err.message);
  process.exit(1);
});
