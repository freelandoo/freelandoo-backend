// Missões e XP da Freelandoo Arena (M12).
//
//   node scripts/arena-missions.js sync [--apply]          → catálogo (seeds/arena-missions.json)
//   node scripts/arena-missions.js pending                  → fatos pendentes / com erro
//   node scripts/arena-missions.js reprocess [--apply]     → processa os pendentes (idempotente)
//   node scripts/arena-missions.js grants --email <e-mail>  → histórico de concessões da conta
//
// Reprocessar NUNCA duplica: contribuição e concessão têm chave única; fato já
// processado é pulado. Usa DATABASE_URL. ⚠️ Com o .env do backend é PRODUÇÃO.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const val = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
  const apply = args.includes("--apply");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (cmd === "sync") {
      const { syncMissions } = require("../src/services/ArenaMissionSync");
      const file = val("--file") ? path.resolve(val("--file")) : path.join(__dirname, "..", "src", "databases", "seeds", "arena-missions.json");
      const out = await syncMissions(client, JSON.parse(fs.readFileSync(file, "utf8")), { apply });
      if (!out.ok) {
        console.error("Recusado:\n  - " + out.errors.join("\n  - "));
        process.exitCode = 1;
      } else console.log(`${apply ? "APLICADO" : "SIMULAÇÃO (nada gravado)"}:`, out.summary);
    } else if (cmd === "pending") {
      const r = await client.query(
        `SELECT fact_type, COUNT(*)::int AS pending, COUNT(*) FILTER (WHERE last_error IS NOT NULL)::int AS with_error, MAX(attempts) AS max_attempts
           FROM public.tb_arena_fact WHERE processed_at IS NULL GROUP BY fact_type`
      );
      console.log(r.rows);
    } else if (cmd === "reprocess") {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE processed_at IS NULL`);
      if (!apply) console.log(`SIMULAÇÃO: ${r.rows[0].n} fato(s) pendente(s). Rode com --apply para processar.`);
      else {
        const pool = require("../src/databases");
        const { processPending } = require("../src/services/ArenaMissionService");
        console.log(await processPending({ db: pool, limit: 5000 }));
        await pool.end();
      }
    } else if (cmd === "grants") {
      const u = (await client.query(`SELECT id_user FROM public.tb_user WHERE email = $1`, [val("--email")])).rows[0];
      if (!u) throw new Error("conta não encontrada");
      const g = await client.query(
        `SELECT mission_key, mission_version, cycle_key, base_xp, factor, xp, fact_type, fact_at, granted_at
           FROM public.tb_arena_xp_grant WHERE id_user = $1 ORDER BY granted_at DESC LIMIT 50`,
        [u.id_user]
      );
      const p = await client.query(`SELECT xp_total, grants, revision FROM public.tb_arena_progression WHERE id_user = $1`, [u.id_user]);
      console.log(JSON.stringify({ progression: p.rows[0] || null, grants: g.rows }, null, 2));
    } else {
      console.error("comando desconhecido; veja o cabeçalho do arquivo");
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}
main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
