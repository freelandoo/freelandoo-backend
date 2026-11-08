// test/areas-ibge.e2e.js — ÁREAS (T2, migs 336/337), ponta a ponta.
//
//   npm run test:areas
//
// Banco: TEST_DATABASE_URL (Postgres portátil na 55432; nunca produção).
// Tudo que o teste grava roda em BEGIN/ROLLBACK.
// Confere:
//   1. carga: 5.571 municípios, 510 áreas do IBGE, todo município com área
//      (menos a capital de SP), código do município gravado, sem "¿" nos nomes;
//   2. override do ABC: os 7 municípios fora da imediata "São Paulo"; as
//      sub-regiões do A1 mantidas; capital sem área; homônimo de outra UF
//      (Santo André/PB) segue o IBGE;
//   3. id_area na gravação (trigger em INSERT e UPDATE da cidade/UF);
//   4. backfill pelo fl_area_rebuild e rebuild idempotente;
//   5. override novo cria área manual, o perfil muda; tirar volta ao IBGE com
//      o MESMO id (posts guardam o id) e a área manual fica inativa;
//   6. geo_tiers: cidade/área/região/UF, fallback no perfil-conta, sem cidade;
//   7. o script gera o mesmo SQL que a migration 337 aplicou.

require("dotenv").config();

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";

if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function main() {
  console.log("━━━ migrations ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "ignore",
  });

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const one = async (sql, args) => (await db.query(sql, args)).rows[0];
  const areaName = async (uf, city) =>
    (await one(`SELECT a.name FROM tb_area a WHERE a.id_area = fl_area_of($1, $2)`, [uf, city]))?.name ?? null;

  console.log("━━━ carga ━━━");
  await check("5.571 municípios e 510 áreas do IBGE, todas com código", async () => {
    const r = await one(`SELECT (SELECT count(*)::int FROM tb_ibge_municipio) mun,
                                (SELECT count(*)::int FROM tb_area WHERE kind = 'ibge') ibge,
                                (SELECT count(*)::int FROM tb_area WHERE kind = 'ibge' AND code_ibge IS NULL) semcod`);
    assert.strictEqual(r.mun, 5571);
    assert.strictEqual(r.ibge, 510);
    assert.strictEqual(r.semcod, 0);
  });
  await check("todo município tem área, menos a capital de SP", async () => {
    const r = await db.query(`SELECT m.uf, m.nome FROM tb_ibge_municipio m
                               WHERE NOT EXISTS (SELECT 1 FROM tb_area_city ac
                                                  WHERE ac.uf = m.uf AND ac.municipio_norm = m.municipio_norm)`);
    assert.deepStrictEqual(r.rows, [{ uf: "SP", nome: "São Paulo" }]);
  });
  await check("cidade do IBGE leva o código do município; nenhuma área sem região", async () => {
    const r = await one(`SELECT count(*) FILTER (WHERE ac.cod_municipio IS NULL
                                                 AND EXISTS (SELECT 1 FROM tb_ibge_municipio m
                                                              WHERE m.uf = ac.uf AND m.municipio_norm = ac.municipio_norm))::int semcod,
                                (SELECT cod_municipio FROM tb_area_city WHERE uf = 'SP' AND municipio_norm = 'campinas') camp,
                                (SELECT count(*)::int FROM tb_area WHERE id_region IS NULL) semreg
                           FROM tb_area_city ac`);
    assert.strictEqual(r.semcod, 0);
    assert.strictEqual(r.camp, 3509502);
    assert.strictEqual(r.semreg, 0);
  });
  await check("nomes compostos com travessão (a API do IBGE manda \"¿\")", async () => {
    const r = await one(`SELECT count(*)::int n FROM tb_area WHERE name LIKE '%¿%'`);
    assert.strictEqual(r.n, 0);
    assert.strictEqual(await areaName("BA", "Ilhéus"), "Ilhéus – Itabuna");
  });

  console.log("━━━ override do ABC ━━━");
  await check("os 7 do ABC na área ABC Paulista", async () => {
    const r = await db.query(`SELECT m.nome FROM tb_area_city ac
                                JOIN tb_area a USING (id_area)
                                JOIN tb_ibge_municipio m ON m.uf = ac.uf AND m.municipio_norm = ac.municipio_norm
                               WHERE a.uf = 'SP' AND a.name = 'ABC Paulista' ORDER BY m.nome`);
    assert.deepStrictEqual(r.rows.map((x) => x.nome), [
      "Diadema", "Mauá", "Ribeirão Pires", "Rio Grande da Serra",
      "Santo André", "São Bernardo do Campo", "São Caetano do Sul",
    ]);
  });
  await check("capital sem área; a imediata São Paulo do IBGE fica vazia e inativa", async () => {
    assert.strictEqual(await areaName("SP", "São Paulo"), null);
    const r = await one(`SELECT is_active FROM tb_area WHERE code_ibge = 350001`);
    assert.strictEqual(r.is_active, false);
  });
  await check("sub-regiões do A1 mantidas (Guarulhos, Osasco, Embu, Cotia)", async () => {
    assert.strictEqual(await areaName("SP", "Guarulhos"), "Alto Tietê");
    assert.strictEqual(await areaName("SP", "Osasco"), "Oeste da Grande SP");
    assert.strictEqual(await areaName("SP", "Embu"), "Sudoeste da Grande SP");
    assert.strictEqual(await areaName("SP", "cotia"), "Sudoeste da Grande SP");
    assert.strictEqual(await areaName("SP", "Franco da Rocha"), "Norte da Grande SP");
  });
  await check("homônimo de outra UF segue o IBGE (Santo André/PB)", async () => {
    assert.strictEqual(await areaName("PB", "Santo André"), "Campina Grande");
    assert.strictEqual(await areaName("sp", " santo andre "), "ABC Paulista");
  });

  // ─── Perfis (tudo em transação) ──────────────────────────────────────────
  await db.query("BEGIN");
  try {
    const stamp = Date.now().toString(36);
    const cat = (await one(`SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1`)).id_category;
    async function user(tag) {
      return (await one(
        `INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento)
         VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01') RETURNING id_user`,
        [tag, `${tag}_${stamp}@ex.com`, `${tag}_${stamp}`]
      )).id_user;
    }
    async function profile(id_user, tag, municipio, estado, account) {
      return (await one(
        `INSERT INTO tb_profile (id_user, display_name, sub_profile_slug, id_category,
                                 is_user_account, is_visible, is_active, municipio, estado)
         VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, $6, $7) RETURNING id_profile, id_area`,
        [id_user, tag, `${tag}-${stamp}`, cat, account, municipio, estado]
      ));
    }
    const areaId = async (uf, name) => (await one(`SELECT id_area FROM tb_area WHERE uf = $1 AND name = $2`, [uf, name])).id_area;
    const idOf = async (id) => (await one(`SELECT id_area FROM tb_profile WHERE id_profile = $1`, [id])).id_area;

    const campinas = await areaId("SP", "Campinas");
    const abc = await areaId("SP", "ABC Paulista");
    const u1 = await user("t2a");
    const p1 = await profile(u1, "t2a", "Campinas", "SP", true);

    console.log("━━━ gravação ━━━");
    await check("INSERT do perfil resolve id_area", async () => {
      assert.strictEqual(p1.id_area, campinas);
    });
    await check("UPDATE da cidade troca a área (Diadema → ABC; capital → nenhuma)", async () => {
      await db.query(`UPDATE tb_profile SET municipio = 'Diadema' WHERE id_profile = $1`, [p1.id_profile]);
      assert.strictEqual(await idOf(p1.id_profile), abc);
      await db.query(`UPDATE tb_profile SET municipio = 'São Paulo' WHERE id_profile = $1`, [p1.id_profile]);
      assert.strictEqual(await idOf(p1.id_profile), null);
      await db.query(`UPDATE tb_profile SET municipio = 'Campinas', estado = 'MG' WHERE id_profile = $1`, [p1.id_profile]);
      assert.strictEqual(await idOf(p1.id_profile), null, "Campinas/MG não existe");
      await db.query(`UPDATE tb_profile SET estado = 'sp' WHERE id_profile = $1`, [p1.id_profile]);
      assert.strictEqual(await idOf(p1.id_profile), campinas);
    });
    await check("não aceita id_area na mão no INSERT (sai sempre da cidade)", async () => {
      const r = await one(
        `INSERT INTO tb_profile (id_user, display_name, sub_profile_slug, id_category,
                                 is_user_account, is_visible, is_active, municipio, estado, id_area)
         VALUES ($1, 'x', $2, $3, FALSE, FALSE, TRUE, 'Santo André', 'SP', $4) RETURNING id_area`,
        [u1, `t2x-${stamp}`, cat, campinas]
      );
      assert.strictEqual(r.id_area, abc);
    });

    console.log("━━━ backfill e rebuild ━━━");
    await check("rebuild refaz o id_area de perfil antigo", async () => {
      await db.query(`UPDATE tb_profile SET id_area = NULL WHERE id_profile = $1`, [p1.id_profile]);
      assert.strictEqual(await idOf(p1.id_profile), null);
      const r = await one(`SELECT * FROM fl_area_rebuild()`);
      assert.ok(r.profiles_changed >= 1);
      assert.strictEqual(await idOf(p1.id_profile), campinas);
    });
    await check("rebuild de novo não muda nada", async () => {
      const before = (await db.query(`SELECT id_area, name, is_active FROM tb_area ORDER BY id_area`)).rows;
      const r = await one(`SELECT * FROM fl_area_rebuild()`);
      assert.strictEqual(r.profiles_changed, 0);
      assert.strictEqual(r.areas_active, 514);
      assert.deepStrictEqual((await db.query(`SELECT id_area, name, is_active FROM tb_area ORDER BY id_area`)).rows, before);
    });

    console.log("━━━ override novo ━━━");
    await check("override cria área manual e leva o perfil; tirar volta ao IBGE com o mesmo id", async () => {
      await db.query(`INSERT INTO tb_area_override (uf, municipio_norm, municipio, area_name, source)
                      VALUES ('SP', fl_norm_city('Campinas'), 'Campinas', 'Área Teste T2', 'teste')`);
      await db.query(`SELECT * FROM fl_area_rebuild()`);
      const manual = await areaId("SP", "Área Teste T2");
      assert.strictEqual(await idOf(p1.id_profile), manual);
      assert.strictEqual(await areaName("SP", "Valinhos"), "Campinas", "o resto da imediata fica");

      await db.query(`DELETE FROM tb_area_override WHERE uf = 'SP' AND municipio_norm = 'campinas'`);
      await db.query(`SELECT * FROM fl_area_rebuild()`);
      assert.strictEqual(await idOf(p1.id_profile), campinas);
      assert.strictEqual(await areaId("SP", "Campinas"), campinas);
      const m = await one(`SELECT is_active FROM tb_area WHERE id_area = $1`, [manual]);
      assert.strictEqual(m.is_active, false);
    });
    await check("override para \"sem área\"", async () => {
      await db.query(`INSERT INTO tb_area_override (uf, municipio_norm, municipio, area_name)
                      VALUES ('SP', 'campinas', 'Campinas', NULL)`);
      await db.query(`SELECT * FROM fl_area_rebuild()`);
      assert.strictEqual(await idOf(p1.id_profile), null);
      await db.query(`DELETE FROM tb_area_override WHERE uf = 'SP' AND municipio_norm = 'campinas'`);
      await db.query(`SELECT * FROM fl_area_rebuild()`);
      assert.strictEqual(await idOf(p1.id_profile), campinas);
    });

    console.log("━━━ geo_tiers ━━━");
    await check("perfil com cidade: cidade, área, região, UF", async () => {
      await db.query(`UPDATE tb_profile SET municipio = 'São Bernardo do Campo' WHERE id_profile = $1`, [p1.id_profile]);
      const g = await one(`SELECT * FROM geo_tiers($1)`, [p1.id_profile]);
      assert.strictEqual(g.city_key, "sao bernardo do campo");
      assert.strictEqual(g.city_name, "São Bernardo do Campo");
      assert.strictEqual(g.id_area, abc);
      assert.strictEqual(g.area_name, "ABC Paulista");
      assert.strictEqual(g.region_name, "Capital e Grande São Paulo");
      assert.strictEqual(g.uf, "SP");
    });
    await check("perfil sem cidade usa o perfil-conta da pessoa", async () => {
      const p2 = await profile(u1, "t2b", null, null, false);
      const g = await one(`SELECT * FROM geo_tiers($1)`, [p2.id_profile]);
      assert.strictEqual(g.area_name, "ABC Paulista");
      assert.strictEqual(g.uf, "SP");
    });
    await check("capital: área nula, região e UF presentes; ninguém: tudo nulo", async () => {
      const u2 = await user("t2c");
      const p3 = await profile(u2, "t2c", "São Paulo", "SP", true);
      const g = await one(`SELECT * FROM geo_tiers($1)`, [p3.id_profile]);
      assert.strictEqual(g.id_area, null);
      assert.strictEqual(g.region_name, "Capital e Grande São Paulo");
      const u3 = await user("t2d");
      const p4 = await profile(u3, "t2d", null, null, true);
      const g4 = await one(`SELECT * FROM geo_tiers($1)`, [p4.id_profile]);
      assert.deepStrictEqual(
        [g4.city_key, g4.id_area, g4.id_region, g4.uf],
        [null, null, null, null]
      );
    });
  } finally {
    await db.query("ROLLBACK");
  }

  console.log("━━━ script ━━━");
  await check("o SQL do script é o mesmo da última migration de dados (CSV mudou = gerar outra)", async () => {
    const { buildSql, loadIbge, loadOverrides } = require("../scripts/ibge-areas");
    const dir = path.join(__dirname, "..", "src", "databases", "migrations");
    const last = fs.readdirSync(dir).filter((f) => /_area_ibge_dados\.sql$/.test(f)).sort().pop();
    const mig = fs.readFileSync(path.join(dir, last), "utf8").replace(/\r\n/g, "\n");
    const body = mig.slice(mig.indexOf("-- Municípios do IBGE"));
    assert.strictEqual(body, buildSql(loadIbge(), loadOverrides()));
  });

  await db.end();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} ok`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
