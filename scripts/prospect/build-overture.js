#!/usr/bin/env node
// scripts/prospect/build-overture.js
// Gera as particoes (uf, categoria) a partir do Overture Maps.
//
//   node scripts/prospect/build-overture.js --uf SP
//   node scripts/prospect/build-overture.js --uf SP --cat barbearia,salao_beleza
//   node scripts/prospect/build-overture.js --all
//
// ─── POR QUE ISTO EXISTE (e por que nao e o build-partitions.js) ────────────
//
// O gerador irmao (`build-partitions.js`) le a Overpass. Ele continua valendo e
// nao foi tocado — o que mudou foi a resposta a "de onde vem a descoberta".
//
// O numero que decidiu foi MEDIDO na propria fonte: **zero barbearias mapeadas
// em Diadema no OSM**, contra 302 no Overture. No estado de Sao Paulo, 821
// contra 43.250. E as categorias que o OSM praticamente ignora sao justamente
// as que atendem na casa do cliente: eletricista 39 → 2.007, energia solar
// 4 → 964, grafica 119 → 8.060, contador 166 → 11.450.
//
// ⚠️ O GARGALO OPERACIONAL SOME JUNTO. A Overpass publica da 2 slots por IP e
// uma consulta de 5s ocupa o slot por ~47s: o lote de 27 UF x 31 categorias
// levava ~5h com pacing, com 504 em serie no meio. O Overture e um arquivo
// PARQUET ESTATICO no S3 — nao ha slot para esperar, nao ha 429 para tomar, e
// o recorte por `bbox` e empurrado para o arquivo (o leitor so baixa os pedacos
// que interessam).
//
// ⚠️ UMA VARREDURA POR UF, NAO UMA POR CATEGORIA. Sao 31 categorias e o parquet
// e grande: 31 leituras completas seriam 31x o trabalho pelo mesmo dado. Aqui a
// consulta traz TODAS as categorias que nos interessam de uma vez e a separacao
// acontece em memoria, com a mesma regua que o backend usa
// (`categoryFromOvertureCategory`).
//
// ⚠️ A CIDADE VEM DA GEOMETRIA, NUNCA DE `addresses.locality` — e esta e a
// decisao que faz a TELA funcionar. O seletor de cidade do front envia o nome
// do IBGE ("Diadema", "Sao Bernardo do Campo"); o `locality` do Overture tem
// variantes ("Sao Paulo" sem acento aparece ao lado de "Sao Paulo"). Gravando o
// `locality`, o filtro por cidade erraria em silencio para as variantes. Quem
// resolve e a malha municipal do IBGE, por point-in-polygon — a MESMA fonte que
// alimenta o seletor.
//
// ⚠️ DEPENDE DO DuckDB CLI, que este script baixa sozinho na primeira execucao.
// Ele NAO e dependencia do backend: nada disto roda em producao, o resultado e
// um arquivo que vai para o R2 e e o `r2Partition` que o le.

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const readline = require("readline");
const { loadUf } = require("./lib/geo");
const overture = require("../../src/integrations/companyProvider/overture");
// ⚠️ `CATEGORIES` E NAO `listCategories()`: aquela e a projecao DA TELA, so
// `{key,label}`, e ela e estreita de proposito — vai para a API publica e nao
// deve carregar o mapa de tags. Este script e interno e precisa do `overture`.
const { CATEGORIES, getCategory } = require("../../src/utils/companyCategories");

/** Release do Overture. Versionado de proposito: lote e uma decisao, nao o calendario. */
const RELEASE = process.env.OVERTURE_RELEASE || "2026-08-19.0";
const S3 = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*`;

const OUT = path.resolve(__dirname, "../../.prospect-out-overture");
const BIN = path.join(os.homedir(), ".freelandoo-duckdb");

const UF_CODE = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43,
  MS: 50, MT: 51, GO: 52, DF: 53,
};

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

/**
 * Acha o DuckDB, baixando-o se preciso.
 *
 * Preferir o que ja esta no PATH e deliberado: quem ja tem uma instalacao nao
 * ganha uma segunda copia escondida no home.
 */
function duckdb() {
  for (const cand of ["duckdb", path.join(BIN, process.platform === "win32" ? "duckdb.exe" : "duckdb")]) {
    try {
      execFileSync(cand, ["--version"], { stdio: "ignore" });
      return cand;
    } catch { /* tenta o proximo */ }
  }
  const alvo = {
    win32: "duckdb_cli-windows-amd64.zip",
    darwin: "duckdb_cli-osx-universal.zip",
    linux: "duckdb_cli-linux-amd64.zip",
  }[process.platform];
  if (!alvo) throw new Error("plataforma sem binario do DuckDB: " + process.platform);

  log("baixando DuckDB CLI (uma vez so) ...");
  fs.mkdirSync(BIN, { recursive: true });
  const zip = path.join(BIN, alvo);
  execFileSync("curl", ["-sL", "-o", zip, `https://github.com/duckdb/duckdb/releases/latest/download/${alvo}`]);
  // ⚠️ DOIS EXTRATORES, E OS DOIS MOTIVOS JA FORAM PAGOS AQUI.
  //   `unzip` primeiro: o release e um .zip, e o `tar` do Git Bash e GNU tar,
  //          que NAO le zip ("This does not look like a tar archive").
  //   nome RELATIVO + `cwd`: o tar do Windows le `C:...` como HOST REMOTO e
  //          falha com "Cannot connect to C: resolve failed" — uma mensagem
  //          que nao fala de caminho nenhum.
  let extraiu = false;
  for (const [cmd, args] of [["unzip", ["-o", "-q", alvo]], ["tar", ["-xf", alvo]]]) {
    try { execFileSync(cmd, args, { cwd: BIN, stdio: "ignore" }); extraiu = true; break; }
    catch { /* tenta o proximo */ }
  }
  if (!extraiu) throw new Error("nao consegui extrair " + alvo + " (tente instalar o duckdb manualmente e deixa-lo no PATH)");
  fs.unlinkSync(zip);
  const bin = path.join(BIN, process.platform === "win32" ? "duckdb.exe" : "duckdb");
  execFileSync(bin, ["--version"], { stdio: "ignore" });
  return bin;
}

/**
 * O pedaco de SQL que reconhece as categorias que nos interessam.
 *
 * ⚠️ O CURINGA VIRA `LIKE`, e o unico curinga aceito e `*` na ponta — o mesmo
 * contrato de `categoryFromOvertureCategory`. Interpretar o padrao como regex
 * aqui daria expressividade que ninguem pediu e um jeito novo de errar.
 */
function categoryFilterSql(cats) {
  const exatas = [];
  const likes = [];
  for (const c of cats) {
    for (const pat of c.overture) {
      if (!pat.includes("*")) { exatas.push(pat); continue; }
      if (pat.startsWith("*")) likes.push("%" + pat.slice(1));
      else if (pat.endsWith("*")) likes.push(pat.slice(0, -1) + "%");
    }
  }
  const partes = [];
  if (exatas.length) partes.push("categories.primary IN (" + exatas.map((e) => `'${e}'`).join(", ") + ")");
  for (const l of likes) partes.push(`categories.primary LIKE '${l}'`);
  return "(" + partes.join(" OR ") + ")";
}

/**
 * Roda a consulta e, falhando, DIZ O PORQUE.
 *
 * ⚠️ `stdio: inherit` no stderr engolia o motivo: a falha chegava como
 * "Command failed: duckdb.exe -c .read ..." depois de onze minutos, sem uma
 * palavra sobre o que aconteceu. Capturado, o erro do DuckDB (falta de
 * memoria, credencial, coluna) aparece na hora.
 */
function runQuery(bin, sql, destino) {
  const arquivo = path.join(OUT, "_q.sql");
  fs.writeFileSync(arquivo, sql);
  try {
    execFileSync(bin, ["-c", `.read ${arquivo.replace(/\\/g, "/")}`], {
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 1 << 28,
    });
  } catch (err) {
    const detalhe = String(err.stderr || "").trim() || err.message;
    throw new Error("DuckDB falhou: " + detalhe.split("\n").slice(0, 4).join(" | "));
  }
  fs.unlinkSync(arquivo);
  if (!fs.existsSync(destino)) throw new Error("consulta nao produziu " + destino);
}

async function buildUf({ uf, cats, bin, rebuild }) {
  const geo = await loadUf(UF_CODE[uf]);
  const [xmin, ymin, xmax, ymax] = geo.bbox;
  log(`  malha IBGE: ${geo.size} municipios | bbox ${xmin.toFixed(2)},${ymin.toFixed(2)} ${xmax.toFixed(2)},${ymax.toFixed(2)}`);

  const bruto = path.join(OUT, `_${uf}.json`);

  const sql = [
    "INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;",
    "SET s3_region='us-west-2';",
    // ⚠️ OS TRES PRAGMAS SAO O QUE FAZ O ESTADO INTEIRO CABER. Com as 31
    // categorias de SP o export passa de 290 MB e o DuckDB morria DEPOIS de
    // ter escrito o arquivo — o .json ficava integro e o processo saia com
    // erro, que e o pior dos dois mundos para diagnosticar.
    //   memory_limit      → teto explicito em vez de 80% da RAM da maquina
    //   temp_directory    → ter para onde derramar quando o teto chega
    //   preserve_insertion_order=false → deixa o COPY transmitir em vez de
    //     segurar o resultado inteiro so para manter a ordem, que aqui nao
    //     significa nada (a particao e um conjunto, nao uma lista ordenada)
    `SET memory_limit='${process.env.OVERTURE_MEM || "3GB"}';`,
    `SET temp_directory='${OUT.replace(/\\/g, "/")}/_tmp';`,
    "SET preserve_insertion_order=false;",
    "COPY (",
    "  SELECT id, names.primary AS name, categories.primary AS category,",
    "         ST_Y(geometry) AS lat, ST_X(geometry) AS lon,",
    "         phones, websites, socials, emails,",
    "         addresses[1].freeform AS address, addresses[1].postcode AS zip",
    `  FROM read_parquet('${S3}', hive_partitioning=1)`,
    `  WHERE bbox.xmin BETWEEN ${xmin} AND ${xmax}`,
    `    AND bbox.ymin BETWEEN ${ymin} AND ${ymax}`,
    "    AND names.primary IS NOT NULL",
    `    AND ${categoryFilterSql(cats)}`,
    `) TO '${bruto.replace(/\\/g, "/")}' (FORMAT JSON, ARRAY false);`,
  ].join("\n");

  // ⚠️ O BRUTO E A PARTE CARA (minutos de varredura no S3). Reaproveita-lo
  // quando ja esta la e o que transforma um erro na etapa seguinte em uma
  // nova tentativa de segundos, em vez de outra varredura inteira.
  if (fs.existsSync(bruto) && !rebuild) {
    log(`  bruto reaproveitado (${(fs.statSync(bruto).size / 1024 / 1024).toFixed(1)} MB) — use --rebuild para refazer`);
  } else {
    log("  consultando o Overture (uma varredura para todas as categorias) ...");
    const t0 = Date.now();
    runQuery(bin, sql, bruto);
    log(`  bruto em ${((Date.now() - t0) / 1000).toFixed(1)}s (${(fs.statSync(bruto).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // Um fluxo de escrita por categoria: o estado inteiro nao cabe confortavelmente
  // em memoria e acumular arrays so para gravar no fim seria gastar RAM a toa.
  const saida = new Map();
  for (const c of cats) {
    const tmp = path.join(OUT, `uf=${uf}`, `cat=${c.key}.ndjson.gz.tmp`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const gz = zlib.createGzip({ level: 9 });
    gz.pipe(fs.createWriteStream(tmp));
    saida.set(c.key, { gz, tmp, n: 0, cidades: new Set() });
  }

  let lidas = 0, semCategoria = 0, semNome = 0, foraDaUf = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(bruto), crlfDelay: Infinity });
  for await (const linha of rl) {
    if (!linha.trim()) continue;
    lidas += 1;
    let row;
    try { row = JSON.parse(linha); } catch { continue; }

    const draft = overture.toDraft(row);
    if (!draft) { semNome += 1; continue; }

    // ⚠️ A CATEGORIA RESOLVIDA MANDA, e este filtro nao e redundante com o
    // WHERE. A consulta traz `fast_food_restaurant` porque ele casa o curinga
    // `*_restaurant` de `restaurante` — mas a regua o classifica como `bar`,
    // que e onde a lanchonete mora aqui. Sem isto, a particao de restaurantes
    // receberia lanchonetes e a contagem da tela mentiria nos dois lados.
    const key = draft.fields.category_key;
    const alvo = key ? saida.get(key) : null;
    if (!alvo) { semCategoria += 1; continue; }

    // ⚠️ GEOMETRIA, NAO `locality` — ver o cabecalho. E o que faz o nome
    // gravado ser identico ao que o seletor de cidade envia.
    const hit = geo.resolve(draft.fields.latitude, draft.fields.longitude);
    if (!hit) { foraDaUf += 1; continue; }
    draft.fields.city = hit.name;
    draft.fields.uf = uf;
    draft.ibge_code = hit.code;

    alvo.gz.write(JSON.stringify(draft) + "\n");
    alvo.n += 1;
    alvo.cidades.add(hit.name);
  }

  const resumo = [];
  for (const [key, s] of saida) {
    await new Promise((res) => { s.gz.end(res); });
    const fim = s.tmp.replace(/\.tmp$/, "");
    // ⚠️ ESCRITA ATOMICA: tmp + rename. Sem ela, uma queda no meio deixa um .gz
    // pela metade que o `--resume` trata como pronto — o buraco entra na base
    // sem erro e so aparece quando alguem procurar naquela cidade.
    fs.renameSync(s.tmp, fim);
    resumo.push({ uf, category: key, gravados: s.n, cidades: s.cidades.size, bytes: fs.statSync(fim).size });
  }

  log(`  lidas ${lidas} | sem nome ${semNome} | categoria fora do catalogo ${semCategoria} | fora da malha ${foraDaUf}`);
  return resumo;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  const ufs = args.includes("--all")
    ? Object.keys(UF_CODE)
    : (get("--uf") || "SP").toUpperCase().split(",").map((s) => s.trim());

  const catArg = get("--cat");
  const cats = (catArg ? catArg.split(",").map((x) => getCategory(x.trim())) : CATEGORIES).filter(Boolean);
  if (catArg && cats.length !== catArg.split(",").length) throw new Error("categoria desconhecida em --cat");
  const force = args.includes("--force");
  const rebuild = args.includes("--rebuild");

  fs.mkdirSync(OUT, { recursive: true });
  const bin = duckdb();
  log(`DuckDB: ${bin}`);
  log(`release do Overture: ${RELEASE}`);
  log(`${ufs.length} UF x ${cats.length} categorias -> ${OUT}`);

  const resumo = [];
  for (const uf of ufs) {
    if (!UF_CODE[uf]) { log("UF desconhecida: " + uf); continue; }
    const pronto = path.join(OUT, `uf=${uf}`, `cat=${cats[0].key}.ndjson.gz`);
    if (!force && fs.existsSync(pronto)) { log(`=== ${uf}: ja existe, pulando (--force refaz) ===`); continue; }
    log(`\n=== ${uf} ===`);
    try {
      const r = await buildUf({ uf, cats, bin, rebuild });
      r.sort((a, b) => b.gravados - a.gravados);
      for (const x of r) {
        log(`  ${x.category.padEnd(20)}${String(x.gravados).padStart(7)} leads | ${String(x.cidades).padStart(3)} cidades | ${(x.bytes / 1024).toFixed(0).padStart(6)} KB`);
      }
      resumo.push(...r);
    } catch (err) {
      log(`  FALHOU: ${err.message}`);
      resumo.push({ uf, erro: err.message });
    }
  }

  const total = resumo.reduce((a, r) => a + (r.gravados || 0), 0);
  const bytes = resumo.reduce((a, r) => a + (r.bytes || 0), 0);
  log(`\n=== TOTAL: ${total} leads em ${resumo.length} particoes, ${(bytes / 1024 / 1024).toFixed(1)} MB ===`);
  fs.writeFileSync(path.join(OUT, "_resumo.json"), JSON.stringify(resumo, null, 2));
  log(`\nsubir:  node scripts/prospect/upload-partitions.js --out ${path.basename(OUT)} --prefix prospect/overture/<AAAA-MM>`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { categoryFilterSql, UF_CODE, OUT };
