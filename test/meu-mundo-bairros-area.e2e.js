// B1 (2026-11-08): bairro por classe + área (mig 400).
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/<banco> npm run test:meu-mundo-bairros
"use strict";
const url = process.env.TEST_DATABASE_URL;
if (!url || !/127\.0\.0\.1|localhost/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let PASS = 0;
let FAIL = 0;
function check(name, ok, info = "") {
  if (ok) PASS++;
  else FAIL++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !info ? "" : " — " + info}`);
}

async function bootstrap(pool) {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_profile (id_user UUID, id_area INT, is_user_account BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ)`);
  const dir = path.join(__dirname, "../src/databases/migrations");
  // só as do bairro (casas, classes) e a nova
  for (const f of fs.readdirSync(dir).filter((f) => /^(29[0-9]|318|400)_meu_mundo/.test(f)).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const S = require("../src/storages/MeuMundoStorage");
  const user = async (area) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, "u" + id.slice(0, 6), id + "@t"]);
    if (area !== undefined) await pool.query(`INSERT INTO tb_profile (id_user, id_area) VALUES ($1, $2)`, [id, area]);
    return id;
  };
  const nbOf = async (id) => (await S.getActiveResidence(pool, id)).id_neighborhood;
  const areaOfNb = async (nb) => (await pool.query(`SELECT id_area FROM tb_mm_neighborhood WHERE id_neighborhood = $1`, [nb])).rows[0].id_area;

  const a1 = await user(10);
  const a2 = await user(10);
  const b1 = await user(20);
  const none = await user(undefined);
  await S.ensureResidence(pool, a1, "vampiro");
  await S.ensureResidence(pool, a2, "vampiro");
  await S.ensureResidence(pool, b1, "vampiro");
  check("mesma classe e mesma área = mesmo bairro", (await nbOf(a1)) === (await nbOf(a2)));
  check("o bairro guarda a área", (await areaOfNb(await nbOf(a1))) === 10);
  check("outra área = outro bairro", (await nbOf(b1)) !== (await nbOf(a1)) && (await areaOfNb(await nbOf(b1))) === 20);
  await S.ensureResidence(pool, none, "vampiro");
  check("sem cidade cai num bairro da classe com vaga", [await nbOf(a1), await nbOf(b1)].includes(await nbOf(none)));
  const fox = await user(10);
  await S.ensureResidence(pool, fox, "raposa");
  check("outra classe na mesma área = outro bairro", (await nbOf(fox)) !== (await nbOf(a1)));
  // enche o bairro da área 10 e confere que o próximo nasce na mesma área
  const lots = Number((await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_lot WHERE id_neighborhood = $1`, [await nbOf(a1)])).rows[0].n);
  const filled = Number((await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_residence r JOIN tb_mm_house h ON h.id_house = r.id_house JOIN tb_mm_lot l ON l.id_lot = h.id_lot WHERE l.id_neighborhood = $1 AND r.status = 'active'`, [await nbOf(a1)])).rows[0].n);
  for (let i = filled; i < lots; i++) await S.ensureResidence(pool, await user(10), "vampiro");
  const extra = await user(10);
  await S.ensureResidence(pool, extra, "vampiro");
  check("bairro da área cheio: nasce outro da mesma área", (await nbOf(extra)) !== (await nbOf(a1)) && (await areaOfNb(await nbOf(extra))) === 10);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
