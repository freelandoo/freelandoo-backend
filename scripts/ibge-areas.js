#!/usr/bin/env node
// scripts/ibge-areas.js — ÁREAS (T2): Regiões Geográficas Imediatas do IBGE
// + overrides manuais → tb_area / tb_area_city / tb_profile.id_area.
//
// Arquivos (os dois são a fonte; o banco é refeito a partir deles):
//   scripts/data/ibge-regioes-imediatas.csv  oficial, um município por linha
//   scripts/data/area-overrides.csv          ajustes à mão (uf;municipio;area;fonte)
//                                            área vazia = município SEM área
//
// Comandos:
//   node scripts/ibge-areas.js fetch        baixa do IBGE (API de localidades,
//                                           Divisão Regional 2017) e regrava o CSV
//   node scripts/ibge-areas.js sql NNN      gera src/databases/migrations/NNN_area_ibge_dados.sql
//                                           (é assim que chega à produção: no boot)
//   node scripts/ibge-areas.js apply        aplica direto no DATABASE_URL
//                                           (carga + overrides + fl_area_rebuild)
//
// Ajustar uma área depois = editar area-overrides.csv e gerar uma migration
// nova com `sql NNN`. Não precisa mexer em código.

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(__dirname, "data");
const IBGE_CSV = path.join(DATA, "ibge-regioes-imediatas.csv");
const OVERRIDES_CSV = path.join(DATA, "area-overrides.csv");
const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
const IBGE_HEADER = "cod_municipio;municipio;uf;cod_rgi;nome_rgi;cod_rgint;nome_rgint";

// A API do IBGE devolve o travessão dos nomes compostos como "¿"
// ("Ilhéus ¿ Itabuna"); o nome oficial usa "–".
function fixName(s) {
  return String(s).replace(/\s*¿\s*/g, " – ").trim();
}

function readCsv(file) {
  let text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const header = lines.shift().split(";").map((h) => h.trim());
  return lines.map((l) => {
    const cols = l.split(";");
    const row = {};
    header.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    return row;
  });
}

function loadIbge() {
  const rows = readCsv(IBGE_CSV).map((r) => ({
    cod_municipio: Number(r.cod_municipio),
    municipio: r.municipio,
    uf: r.uf.toUpperCase(),
    cod_rgi: Number(r.cod_rgi),
    nome_rgi: r.nome_rgi,
    cod_rgint: Number(r.cod_rgint),
    nome_rgint: r.nome_rgint,
  }));
  for (const r of rows) {
    if (!Number.isInteger(r.cod_municipio) || !Number.isInteger(r.cod_rgi) || !/^[A-Z]{2}$/.test(r.uf)) {
      throw new Error(`linha inválida no CSV do IBGE: ${JSON.stringify(r)}`);
    }
  }
  if (rows.length < 5500) throw new Error(`CSV do IBGE com ${rows.length} municípios (esperado ~5.571)`);
  return rows;
}

function loadOverrides() {
  return readCsv(OVERRIDES_CSV).map((r) => {
    const uf = (r.uf || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf) || !r.municipio) {
      throw new Error(`override inválido: ${JSON.stringify(r)}`);
    }
    return { uf, municipio: r.municipio, area: r.area || null, fonte: r.fonte || null };
  });
}

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// SQL único: usado pela migration gerada e pelo `apply`.
function buildSql(ibge, overrides) {
  const out = [];
  out.push("-- Municípios do IBGE com a Região Geográfica Imediata/Intermediária (2017).");
  for (let i = 0; i < ibge.length; i += 500) {
    const chunk = ibge.slice(i, i + 500);
    out.push(
      "INSERT INTO public.tb_ibge_municipio (cod_municipio, nome, uf, municipio_norm, cod_rgi, nome_rgi, cod_rgint, nome_rgint)\nSELECT v.cod, v.nome, v.uf, fl_norm_city(v.nome), v.rgi, v.nrgi, v.rgint, v.nrgint\n  FROM (VALUES\n" +
        chunk
          .map(
            (r) =>
              `  (${r.cod_municipio},${q(r.municipio)},${q(r.uf)},${r.cod_rgi},${q(r.nome_rgi)},${r.cod_rgint},${q(r.nome_rgint)})`
          )
          .join(",\n") +
        "\n  ) AS v(cod, nome, uf, rgi, nrgi, rgint, nrgint)\n" +
        "ON CONFLICT (cod_municipio) DO UPDATE SET nome = EXCLUDED.nome, uf = EXCLUDED.uf,\n" +
        "  municipio_norm = EXCLUDED.municipio_norm, cod_rgi = EXCLUDED.cod_rgi, nome_rgi = EXCLUDED.nome_rgi,\n" +
        "  cod_rgint = EXCLUDED.cod_rgint, nome_rgint = EXCLUDED.nome_rgint;"
    );
  }
  out.push("");
  out.push("-- Overrides: o arquivo é a lista inteira (o que saiu dele sai da tabela).");
  out.push("DELETE FROM public.tb_area_override;");
  if (overrides.length) {
    out.push(
      "INSERT INTO public.tb_area_override (uf, municipio_norm, municipio, area_name, source)\nSELECT v.uf, fl_norm_city(v.mun), v.mun, v.area, v.src\n  FROM (VALUES\n" +
        overrides.map((o) => `  (${q(o.uf)},${q(o.municipio)},${q(o.area)}::text,${q(o.fonte)}::text)`).join(",\n") +
        "\n  ) AS v(uf, mun, area, src)\nON CONFLICT (uf, municipio_norm) DO UPDATE\n" +
        "  SET municipio = EXCLUDED.municipio, area_name = EXCLUDED.area_name, source = EXCLUDED.source;"
    );
  }
  out.push("");
  out.push("-- Refaz áreas, cidades e o id_area de todos os perfis.");
  out.push("SELECT * FROM fl_area_rebuild();");
  return out.join("\n") + "\n";
}

async function cmdFetch() {
  const res = await fetch(IBGE_URL);
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  const list = await res.json();
  const rows = list.map((m) => {
    const rgi = m["regiao-imediata"];
    const rgint = rgi["regiao-intermediaria"];
    return [m.id, fixName(m.nome), rgint.UF.sigla, rgi.id, fixName(rgi.nome), rgint.id, fixName(rgint.nome)];
  });
  rows.sort((a, b) => a[0] - b[0]);
  for (const r of rows) if (r.some((c) => String(c).includes(";"))) throw new Error(`";" no nome: ${r}`);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(
    IBGE_CSV,
    `# Fonte: IBGE, Divisão Regional do Brasil em Regiões Geográficas Imediatas e Intermediárias (2017),\n` +
      `# via ${IBGE_URL} — baixado em ${new Date().toISOString().slice(0, 10)}.\n` +
      IBGE_HEADER + "\n" + rows.map((r) => r.join(";")).join("\n") + "\n"
  );
  console.log(`${rows.length} municípios, ${new Set(rows.map((r) => r[3])).size} regiões imediatas → ${IBGE_CSV}`);
}

function cmdSql(num) {
  if (!/^\d{3}$/.test(num || "")) throw new Error("uso: node scripts/ibge-areas.js sql NNN");
  const ibge = loadIbge();
  const overrides = loadOverrides();
  const file = path.join(__dirname, "..", "src", "databases", "migrations", `${num}_area_ibge_dados.sql`);
  if (fs.existsSync(file)) throw new Error(`${file} já existe (migration aplicada não se edita: use outro número)`);
  const head =
    `-- =============================================================================\n` +
    `-- Migration ${num}: dados das ÁREAS (T2) — GERADA por scripts/ibge-areas.js sql ${num}\n` +
    `-- =============================================================================\n` +
    `-- Não editar à mão: mude scripts/data/*.csv e gere outra migration.\n` +
    `-- ${ibge.length} municípios do IBGE, ${new Set(ibge.map((r) => r.cod_rgi)).size} regiões imediatas, ${overrides.length} overrides.\n` +
    `-- Estrutura e fl_area_rebuild(): mig 336. Idempotente.\n` +
    `-- =============================================================================\n\n`;
  fs.writeFileSync(file, head + buildSql(ibge, overrides));
  console.log(`gerada ${file}`);
}

async function cmdApply() {
  const pool = require("../src/databases");
  const sql = buildSql(loadIbge(), loadOverrides());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql.replace(/SELECT \* FROM fl_area_rebuild\(\);\s*$/, ""));
    const r = await client.query("SELECT * FROM fl_area_rebuild()");
    await client.query("COMMIT");
    console.log("ok", r.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { buildSql, loadIbge, loadOverrides, fixName };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const run = { fetch: cmdFetch, sql: () => cmdSql(arg), apply: cmdApply }[cmd];
  if (!run) {
    console.error("uso: node scripts/ibge-areas.js fetch | sql NNN | apply");
    process.exit(2);
  }
  Promise.resolve(run()).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
