#!/usr/bin/env node
// scripts/prospect/build-partitions.js
// Gera as partições (uf, categoria) que o R2 vai servir.
//
//   node scripts/prospect/build-partitions.js --uf SP
//   node scripts/prospect/build-partitions.js --uf SP --cat academia,bar
//   node scripts/prospect/build-partitions.js --all
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// A descoberta ao vivo (CompanyWorker.runDiscover) consulta o Overpass por
// (categoria, CIDADE). Para cobrir o país seriam 5.570 municípios × 31
// categorias = **172 mil consultas** a um serviço mantido por doação — que é
// exatamente como se perde acesso a ele.
//
// Aqui a unidade é o ESTADO: 27 × 31 = **837 consultas por execução**, rodadas
// uma vez por mês, com pacing. Isso é uso civilizado, e o resultado fica num
// arquivo que responde a todas as cidades daquele estado sem consultar nada.
//
// ⚠️ ELE REUSA `osm.toDraft` E `osm.buildQuery` DO BACKEND, e isso não é
// comodidade: é o que garante que a linha gerada aqui tem EXATAMENTE a forma
// que a descoberta ao vivo produz. Uma segunda normalização divergiria na
// primeira regra nova — e o sintoma seria empresa importada com campo faltando
// que a varredura ao vivo preenche, sem erro nenhum aparecer.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { loadUf } = require("./lib/geo");
const osm = require("../../src/integrations/companyProvider/osm");
const { listCategories } = require("../../src/utils/companyCategories");

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const UA = "Freelandoo/1.0 (+https://www.freelandoo.com.br; alex.rodriguus@gmail.com)";
const OUT = path.resolve(__dirname, "../../.prospect-out");
const CACHE = path.join(OUT, "_cache");

/** UF → código IBGE. Fonte: /api/v1/localidades/estados. */
const UF_CODE = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43,
  MS: 50, MT: 51, GO: 52, DF: 53,
};

const UF_NAME = {
  RO: "Rondonia", AC: "Acre", AM: "Amazonas", RR: "Roraima", PA: "Para",
  AP: "Amapa", TO: "Tocantins", MA: "Maranhao", PI: "Piaui", CE: "Ceara",
  RN: "Rio Grande do Norte", PB: "Paraiba", PE: "Pernambuco", AL: "Alagoas",
  SE: "Sergipe", BA: "Bahia", MG: "Minas Gerais", ES: "Espirito Santo",
  RJ: "Rio de Janeiro", SP: "Sao Paulo", PR: "Parana", SC: "Santa Catarina",
  RS: "Rio Grande do Sul", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
  GO: "Goias", DF: "Distrito Federal",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

/**
 * ⚠️ ESPERA O SLOT EM VEZ DE DORMIR UM VALOR FIXO. A Overpass pública dá
 * **2 slots por IP** e o `/api/status` diz em quantos segundos o próximo fica
 * livre. Medido: uma consulta de 5s deixou o slot ocupado por 47 segundos.
 * Um `sleep` fixo ou seria lento demais (desperdiçando slot livre) ou curto
 * demais (tomando 429 e queimando a reputação do IP).
 */
async function waitForSlot() {
  const statusUrl = OVERPASS.replace(/\/interpreter$/, "") + "/status";
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(statusUrl, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      const avail = text.match(/(\d+) slots available now/);
      if (avail && Number(avail[1]) > 0) return;
      const m = text.match(/in (\d+) seconds/);
      const wait = m ? Math.min(180, Number(m[1]) + 2) : 30;
      log("  aguardando slot (" + wait + "s)...");
      await sleep(wait * 1000);
    } catch {
      await sleep(20000);
    }
  }
  throw new Error("nenhum slot da Overpass ficou livre");
}

async function cachedJson(name, fn) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const data = await fn();
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

/**
 * (uf) → área do Overpass do ESTADO.
 *
 * ⚠️ Só `relation` serve, pelo mesmo motivo documentado no provider: o offset
 * 3600000000 é o de relação. Um resultado `node` produziria um id de área que
 * não existe e a varredura voltaria vazia, sem erro nenhum.
 */
async function resolveStateArea(uf) {
  return cachedJson("area-" + uf + ".json", async () => {
    const q = new URLSearchParams({
      q: "Estado de " + UF_NAME[uf] + ", Brasil",
      format: "jsonv2",
      limit: "5",
      countrycodes: "br",
    });
    const res = await fetch(NOMINATIM + "/search?" + q, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    const rel = (json || []).find((r) => r.osm_type === "relation");
    if (!rel) throw new Error("nao achei a area do estado " + uf);
    await sleep(1200); // politica do Nominatim: 1 req/s
    return { area: 3600000000 + Number(rel.osm_id), name: rel.display_name };
  });
}

/**
 * ⚠️ FALHA DA OVERPASS E O CASO NORMAL, NAO A EXCECAO — e sem retry a execucao
 * de 837 particoes termina com buracos que ninguem percebe. Medido na primeira
 * rodada: `academia` passou e `bar` tomou **504** no minuto seguinte, com a
 * mesma area e a mesma estrutura de consulta. E instabilidade do lado de la.
 *
 * O backoff e generoso de proposito: 504/429 significam servico sob pressao, e
 * insistir depressa e o comportamento que faz um IP ser bloqueado.
 */
async function overpass(ql, attempt = 1) {
  const MAX = 3;
  await waitForSlot();
  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: ql }).toString(),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) throw new Error("Overpass " + res.status);
    return await res.json();
  } catch (err) {
    if (attempt >= MAX) throw err;
    const wait = 30 * Math.pow(3, attempt - 1); // 30s, 90s
    log("    " + err.message + " — nova tentativa em " + wait + "s (" + (attempt + 1) + "/" + MAX + ")");
    await sleep(wait * 1000);
    return overpass(ql, attempt + 1);
  }
}

async function buildPartition({ uf, area, category, geo }) {
  // `buildQuery` e o DO BACKEND: as tags de cada categoria saem de um lugar so.
  const base = osm.buildQuery({ areaId: area, category, limit: 1 });
  if (!base) throw new Error("categoria desconhecida: " + category);

  // ⚠️ DOIS TETOS DO PROVIDER PRECISAM SAIR AQUI, E OS DOIS CORTAM EM SILENCIO.
  //
  //   `out ... N`  → o provider clampa em 2000 (`Math.min(2000, limit)`), que e
  //                  o certo para UMA cidade e corta um ESTADO pela metade:
  //                  academia em SP tem ~2.325 pontos com nome e voltavam 1.595.
  //   `[timeout:]` → 90s do provider vira 300s, porque a area aqui e ~600x maior.
  //
  // Nenhum dos dois e erro: a Overpass devolve 200 com menos linhas. Por isso o
  // relatorio imprime `elementos` ao lado de `gravados` — e por isso mexer no
  // provider NAO e a saida: aqueles tetos protegem a busca ao vivo.
  const ql = base
    .replace(/\[timeout:\d+\]/, "[timeout:300]")
    .replace(/^out center tags \d+;$/m, "out center tags;");

  const t0 = Date.now();
  const json = await overpass(ql);
  const elements = json.elements || [];

  const lines = [];
  let semNome = 0;
  let semCidade = 0;
  const porCidade = new Map();

  for (const el of elements) {
    const draft = osm.toDraft(el);
    if (!draft) {
      semNome += 1;
      continue;
    }

    const lat = draft.fields.latitude;
    const lon = draft.fields.longitude;
    const hit = lat !== null && lon !== null ? geo.resolve(lat, lon) : null;

    // ⚠️ A GEOMETRIA VENCE `addr:city`, e e decisao. Medido no estado de SP:
    // so 34% dos pontos tem a tag, contra 100% com coordenada. Alem do
    // alcance, a tag carrega DISTRITO ("Parelheiros" em vez de "Sao Paulo"),
    // que partiria o filtro por cidade em pedacos que a tela nao conhece.
    if (hit) {
      draft.fields.city = hit.name;
      draft.ibge_code = hit.code;
    } else if (!draft.fields.city) {
      semCidade += 1;
    }
    draft.fields.uf = uf;

    const c = draft.fields.city || "(sem cidade)";
    porCidade.set(c, (porCidade.get(c) || 0) + 1);
    lines.push(JSON.stringify(draft));
  }

  const dir = path.join(OUT, "uf=" + uf);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "cat=" + category + ".ndjson.gz");
  const body = lines.length ? lines.join("\n") + "\n" : "";
  const gz = zlib.gzipSync(Buffer.from(body, "utf8"), { level: 9 });

  // ⚠️ ESCRITA ATOMICA: grava num temporario e renomeia. Sem isto, uma queda no
  // meio da escrita deixa um .gz pela metade — e o `--resume` da proxima
  // execucao o trata como pronto e PULA a particao. O buraco entra na base sem
  // erro nenhum, e so aparece quando alguem procurar naquela cidade.
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, gz);
  fs.renameSync(tmp, file);

  return {
    category,
    elementos: elements.length,
    gravados: lines.length,
    semNome,
    semCidade,
    cidades: porCidade.size,
    bytes: gz.length,
    ms: Date.now() - t0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  const ufs = args.includes("--all")
    ? Object.keys(UF_CODE)
    : (get("--uf") || "SP").toUpperCase().split(",").map((s) => s.trim());

  const catArg = get("--cat");
  const categories = catArg
    ? catArg.split(",").map((s) => s.trim())
    : listCategories().map((c) => c.key);
  const force = args.includes("--force");

  log("particoes: " + ufs.length + " UF x " + categories.length + " categorias = " + ufs.length * categories.length);
  fs.mkdirSync(OUT, { recursive: true });

  const resumo = [];
  for (const uf of ufs) {
    if (!UF_CODE[uf]) {
      log("UF desconhecida: " + uf);
      continue;
    }
    log("\n=== " + uf + " ===");
    const { area } = await resolveStateArea(uf);
    log("  area OSM: " + area);
    const geo = await loadUf(UF_CODE[uf]);
    log("  malha IBGE: " + geo.size + " municipios");

    for (const category of categories) {
      // ⚠️ RETOMAR E OBRIGATORIO NUM LOTE DE 837. A execucao inteira leva horas
      // e vai ser interrompida — queda de rede, 504 em serie, a maquina que
      // dorme. Sem isto, recomecar refaria as consultas que ja deram certo,
      // gastando de novo a cota de um servico publico pelo mesmo dado.
      const feito = path.join(OUT, "uf=" + uf, "cat=" + category + ".ndjson.gz");
      if (!force && fs.existsSync(feito)) {
        log("  " + category.padEnd(20) + "ja existe, pulando (--force refaz)");
        continue;
      }
      try {
        const r = await buildPartition({ uf, area, category, geo });
        log(
          "  " + category.padEnd(20) +
            String(r.gravados).padStart(6) + " leads | " +
            String(r.cidades).padStart(3) + " cidades | " +
            (r.bytes / 1024).toFixed(0).padStart(5) + " KB | " +
            (r.ms / 1000).toFixed(1) + "s" +
            (r.semCidade ? " | ATENCAO " + r.semCidade + " sem cidade" : "")
        );
        resumo.push({ uf, ...r });
      } catch (err) {
        log("  " + category.padEnd(20) + "FALHOU: " + err.message);
        resumo.push({ uf, category, erro: err.message });
      }
    }
  }

  const total = resumo.reduce((a, r) => a + (r.gravados || 0), 0);
  const bytes = resumo.reduce((a, r) => a + (r.bytes || 0), 0);
  log("\n=== TOTAL: " + total + " leads em " + resumo.length + " particoes, " + (bytes / 1024 / 1024).toFixed(1) + " MB ===");
  fs.writeFileSync(path.join(OUT, "_resumo.json"), JSON.stringify(resumo, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { buildPartition, resolveStateArea, UF_CODE, UF_NAME };
