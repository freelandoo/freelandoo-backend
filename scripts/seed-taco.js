// scripts/seed-taco.js
// Seed idempotente do catálogo de alimentos — TACO/UNICAMP COMPLETA (667
// entradas: 134 curadas originais + 533 da tabela oficial de 597, deduplicada
// por tokens do nome; valores por 100g). Fill-if-absent por
// (source='taco', external_ref) — nunca sobrescreve. Roda no boot (index.js)
// e também via CLI: node scripts/seed-taco.js.
const path = require("path");
const fs = require("fs");

async function seedTacoFoods(pool, log = console) {
  const file = path.join(__dirname, "..", "src", "databases", "data", "taco-foods.json");
  const foods = JSON.parse(fs.readFileSync(file, "utf8"));
  let inserted = 0;
  for (const f of foods) {
    const r = await pool.query(
      `INSERT INTO public.tb_food (source, external_ref, nome, kcal_100g, protein_g, carbs_g, fat_g)
       VALUES ('taco', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (source, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
      [f.ref, f.nome, f.kcal, f.p, f.c, f.g]
    );
    inserted += r.rowCount;
  }
  if (typeof log.info === "function") log.info("seed.taco.done", { total: foods.length, inserted });
  else log.log(`seed TACO: ${inserted}/${foods.length} inseridos`);
  return inserted;
}

module.exports = { seedTacoFoods };

if (require.main === module) {
  const pool = require("../src/databases");
  seedTacoFoods(pool)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("seed TACO falhou:", err.message);
      process.exit(1);
    });
}
