// src/integrations/companyProvider/r2Partition.js
// A base fria: partições (uf, categoria) já prontas, guardadas no R2.
//
// ─── POR QUE ELA EXISTE ─────────────────────────────────────────────────────
//
// A descoberta ao vivo (`osm.js`) consulta a Overpass por (categoria, CIDADE) e
// isso tem um teto duro, MEDIDO e não estimado: a instância pública dá
// **2 slots por IP**, e uma consulta de 5 segundos deixa o slot ocupado por
// ~47 segundos. Como todo o backend sai de um IP só, o teto real é de
// **2 a 3 descobertas por minuto para a plataforma inteira** — e a terceira
// pessoa a apertar "procurar mais" no mesmo minuto espera na fila e depois
// falha.
//
// Aqui o trabalho já foi feito: `scripts/prospect/build-partitions.js` varre o
// ESTADO uma vez por mês (27 × 31 = 837 consultas, com pacing) e deixa o
// resultado num arquivo. Ler esse arquivo não consulta serviço de terceiro
// nenhum, então a mesma busca que hoje espera minutos passa a responder em
// centenas de milissegundos — e mil pessoas pedindo "bar em SP" custam UM
// download, não mil consultas.
//
// ⚠️ ELA NÃO SUBSTITUI A OVERPASS, e isso é deliberado. O arquivo é do último
// lote; um comércio aberto ontem não está nele. A descoberta ao vivo continua
// existindo como o caminho de exceção — para a cidade que o lote não cobriu e
// para quem quiser o dado mais fresco. Quem escolhe é o `ProspectService`.
//
// ⚠️ LEITURA AUTENTICADA (GetObject), NUNCA PELA `R2_PUBLIC_URL`. O bucket é
// compartilhado com mídia servida ao público, e as chaves aqui são previsíveis
// (`prospect/osm/2026-09/uf=SP/cat=bar.ndjson.gz`): pela porta pública, a base
// inteira de leads — que é o ativo compilado da plataforma — sairia para quem
// adivinhasse o caminho.

const zlib = require("zlib");
const { GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");
const { isCategory } = require("../../utils/companyCategories");

const log = createLogger("companyProvider.r2Partition");

const ROOT = "prospect/osm";

/**
 * O prefixo do lote em uso.
 *
 * ⚠️ VERSIONADO POR MÊS, e a variável de ambiente é o interruptor. Sem versão,
 * subir um lote novo por cima teria uma janela em que a busca leria arquivo
 * pela metade; e um lote ruim não teria como ser desfeito sem regerar tudo.
 * Com `PROSPECT_R2_PREFIX`, voltar para o mês anterior é uma linha no Railway.
 */
function currentPrefix() {
  if (process.env.PROSPECT_R2_PREFIX) return process.env.PROSPECT_R2_PREFIX;
  const d = new Date();
  return `${ROOT}/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ⚠️ DESLIGÁVEL POR AMBIENTE (`PROSPECT_R2=off`), como as outras fontes. É a
 * válvula para o dia em que um lote subir errado: a base fria some do caminho e
 * a descoberta ao vivo volta a ser a única fonte, em vez de todo mundo receber
 * dado torto.
 */
function isConfigured() {
  if (String(process.env.PROSPECT_R2 || "on").toLowerCase() === "off") return false;
  return !!process.env.R2_BUCKET_NAME;
}

function keyFor(uf, category) {
  return `${currentPrefix()}/uf=${String(uf).toUpperCase()}/cat=${category}.ndjson.gz`;
}

async function bodyToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Baixa a partição e devolve os rascunhos, na MESMA forma que `osm.toDraft`
 * produz — é o que permite ao `CompanyIngestService` tratar os dois caminhos
 * sem saber de qual vieram.
 *
 * Devolve `null` (e não lista vazia) quando a partição não existe: são coisas
 * diferentes — "este estado/categoria não foi gerado" pede cair para a
 * descoberta ao vivo, enquanto "gerado e vazio" é resposta legítima.
 */
async function fetchPartition({ uf, category }) {
  if (!isConfigured()) return null;
  if (!isCategory(category)) return null;

  const Key = keyFor(uf, category);
  const t0 = Date.now();
  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key })
    );
    const raw = await bodyToBuffer(res.Body);

    // ⚠️ DETECTA O GZIP PELO MAGIC NUMBER (1f 8b) em vez de confiar no
    // `ContentEncoding`. Pelo SDK o corpo vem cru; por uma porta HTTP comum o
    // cliente já teria descomprimido. Assumir um dos dois quebra silenciosamente
    // no dia em que a leitura mudar de caminho.
    const buf =
      raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;

    const drafts = [];
    for (const line of buf.toString("utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const d = JSON.parse(s);
        if (d?.fields?.display_name) drafts.push(d);
      } catch {
        // Linha corrompida não derruba a partição inteira: o resto ainda serve.
      }
    }

    log.info("r2Partition.hit", {
      key: Key,
      drafts: drafts.length,
      bytes: raw.length,
      ms: Date.now() - t0,
    });
    return drafts;
  } catch (err) {
    const code = err?.name || err?.Code;
    if (code === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      log.info("r2Partition.miss", { key: Key });
      return null;
    }
    log.warn("r2Partition.fail", { key: Key, message: err?.message });
    return null;
  }
}

/**
 * O lote tem esta partição? Responde sem baixar nada.
 *
 * ⚠️ É O QUE PERMITE AO "PROCURAR MAIS" DECIDIR SEM ESPERAR. Sem este teste, a
 * única forma de saber seria baixar e ingerir — minutos — ou enfileirar a
 * Overpass às cegas mesmo quando o arquivo já estava pronto ali, gastando a
 * cota diária da pessoa e um slot de um serviço público por dado que a
 * plataforma já tinha.
 */
async function hasPartition({ uf, category }) {
  if (!isConfigured() || !isCategory(category)) return false;
  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: keyFor(uf, category),
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Recorta a partição do estado numa cidade.
 *
 * ⚠️ A COMPARAÇÃO É PELO NOME NORMALIZADO, nunca pelo texto cru: o arquivo traz
 * "São Bernardo do Campo" e a tela manda o que a pessoa digitou. Comparar cru
 * faria "sao bernardo do campo" não achar nada, e a tela diria que a cidade
 * está vazia quando ela tem centenas.
 */
function filterCity(drafts, city, normalizeCity) {
  if (!city) return drafts;
  const want = normalizeCity(city);
  if (!want) return drafts;
  return drafts.filter((d) => normalizeCity(d?.fields?.city || "") === want);
}

module.exports = {
  source: "r2_partition",
  label: "Base fria (R2)",
  isConfigured,
  currentPrefix,
  keyFor,
  fetchPartition,
  hasPartition,
  filterCity,
};
