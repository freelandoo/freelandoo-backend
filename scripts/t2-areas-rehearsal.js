// T2 — ensaio das migrations 336/337 (áreas IBGE) em BEGIN/ROLLBACK.
//
//   DATABASE_URL=<DATABASE_PUBLIC_URL do Postgres> node scripts/t2-areas-rehearsal.js
//
// Imprime áreas/cidades, perfis com área antes × depois, o ABC e a capital.
// Sempre termina em ROLLBACK (nada fica gravado).
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("../src/databases/prodGuard").assertDbAllowed(process.env.DATABASE_URL, { label: "DATABASE_URL" }); // segurança 0B: remoto só com --prod

const MIGS = ["336_area_ibge.sql", "337_area_ibge_dados.sql"];

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL obrigatório");
  const c = new Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query("BEGIN");
    const applied = (await c.query(
      `SELECT filename FROM schema_migrations WHERE filename = ANY($1) AND success`, [MIGS]
    )).rows;
    if (applied.length) console.log("já aplicadas:", applied.map((r) => r.filename).join(", "));
    const before = (await c.query(`SELECT count(*)::int perfis,
        count(*) FILTER (WHERE COALESCE(trim(municipio), '') <> '')::int com_cidade FROM tb_profile`)).rows[0];
    for (const m of MIGS) {
      const t0 = Date.now();
      await c.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations", m), "utf8"));
      console.log(`ok ${m} (${Date.now() - t0} ms)`);
    }
    const after = (await c.query(`SELECT
        (SELECT count(*)::int FROM tb_area WHERE is_active) areas_ativas,
        (SELECT count(*)::int FROM tb_area_city) cidades,
        (SELECT count(*)::int FROM tb_profile WHERE id_area IS NOT NULL) perfis_com_area,
        (SELECT count(*)::int FROM tb_profile p WHERE COALESCE(trim(p.municipio), '') <> ''
            AND p.id_area IS NULL) com_cidade_sem_area,
        (SELECT count(*)::int FROM tb_area_city ac JOIN tb_area a USING (id_area)
          WHERE a.uf = 'SP' AND a.name = 'ABC Paulista') abc,
        (SELECT fl_area_of('SP', 'São Paulo')) capital`)).rows[0];
    const semArea = (await c.query(`SELECT upper(trim(estado)) uf, municipio, count(*)::int n
        FROM tb_profile WHERE COALESCE(trim(municipio), '') <> '' AND id_area IS NULL
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`)).rows;
    console.log(JSON.stringify({ before, after, com_cidade_sem_area_top: semArea }, null, 2));
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
