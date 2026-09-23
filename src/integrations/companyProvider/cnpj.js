// src/integrations/companyProvider/cnpj.js
// Dados abertos de CNPJ — a fonte OFICIAL, consultada SOB DEMANDA.
//
// ⚠️⚠️ POR QUE CONSULTA E NÃO IMPORTAÇÃO DO DUMP — leia antes de "melhorar".
//
// Os Dados Abertos da Receita são ~60 milhões de estabelecimentos, ~5 GB
// comprimidos e ~40 GB em tabela. Importá-los para o Postgres que serve a
// Freelandoo inteira significaria:
//
//   · multiplicar por muitas vezes o tamanho (e o custo) do banco de produção;
//   · horas de ingestão a cada atualização mensal;
//   · e, o mais importante: NÃO RESOLVERIA A PERGUNTA DA TELA. O cadastro da
//     Receita não tem coordenada, não sabe o que é "perto", e o CNAE é a
//     atividade DECLARADA — buscar "academias em São Bernardo" nele traria
//     holdings e MEIs de consultoria junto, e deixaria de fora a academia cujo
//     CNAE principal é "comércio de suplementos".
//
// Quem responde àquela pergunta é o OSM (ver `osm.js`). O CNPJ entra DEPOIS,
// para dizer quem a empresa é de verdade: razão social, situação cadastral,
// porte, capital, data de abertura, CNAE. É o degrau de maior confiança da
// escada em `utils/companyConfidence.js` — e é barato, porque só roda para as
// empresas que alguém de fato quis prospectar.
//
// ⚠️ O IMPORTADOR EM MASSA FICA PROJETADO E DESLIGADO. `tb_company` já tem
// TODAS as colunas dele. No dia em que valer a pena (volume que justifique, ou
// um banco à parte), ele preenche as mesmas linhas por `ON CONFLICT (cnpj)` e
// nada precisa ser reinterpretado. O caminho está aberto; o custo, não pago.

const { createLogger } = require("../../utils/logger");
const N = require("../../utils/companyNormalize");
const { categoryFromCnae } = require("../../utils/companyCategories");

const log = createLogger("companyProvider.cnpj");

// BrasilAPI: pública, sem chave, e ela mesma agrega a fonte da Receita. O
// endereço é env para que trocar de provedor (ou apontar para um espelho
// interno no dia da importação em massa) seja configuração, não deploy.
const BASE = process.env.CNPJ_API_URL || "https://brasilapi.com.br/api/cnpj/v1";
const TIMEOUT_MS = 12_000;
const UA = "Freelandoo/1.0 (+https://www.freelandoo.com.br)";

/**
 * ⚠️ SEM CHAVE, MAS COM VÁLVULA. `CNPJ_LOOKUP=off` tira a fonte da lista — é o
 * que se usa quando o provedor público nos limita: o enriquecimento passa a
 * rodar só com site e OSM, e a tela diz que o CNPJ está indisponível, em vez de
 * enfileirar trabalho que vai falhar em série.
 */
function isConfigured() {
  return String(process.env.CNPJ_LOOKUP || "on").toLowerCase() !== "off";
}

/**
 * Situação cadastral da Receita, normalizada.
 *
 * ⚠️ O FILTRO "SÓ EMPRESA ATIVA" DA TELA DEPENDE DISTO. A API devolve o texto
 * em caixas e grafias variadas ("ATIVA", "Ativa", "BAIXADA"); guardar cru faria
 * o filtro casar com uma grafia e perder as outras, em silêncio.
 */
function normStatus(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("ATIV")) return "ativa";
  if (s.startsWith("BAIX")) return "baixada";
  if (s.startsWith("SUSP")) return "suspensa";
  if (s.startsWith("INAP")) return "inapta";
  if (s.startsWith("NULA")) return "nula";
  return s.toLowerCase().slice(0, 24);
}

/**
 * Porte, normalizado para a lista da tela.
 *
 * A API devolve ora o código ("01", "03", "05"), ora o texto. Os dois entram.
 */
function normSize(raw, code) {
  const c = String(code ?? "").trim();
  if (c === "1" || c === "01") return "mei";
  if (c === "3" || c === "03") return "me";
  if (c === "5" || c === "05") return "demais";
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  if (s.includes("MICRO EMPRESA") || s === "ME") return "me";
  if (s.includes("PEQUENO PORTE") || s === "EPP") return "epp";
  if (s.includes("DEMAIS")) return "demais";
  return s.toLowerCase().slice(0, 24);
}

/**
 * ⚠️ CAPITAL SOCIAL EM CENTAVOS, e a conversão é o ponto mais fácil de errar.
 *
 * A API devolve `capital_social` como NÚMERO EM REAIS (50000 = cinquenta mil
 * reais). Guardar esse número direto numa coluna que a plataforma inteira lê
 * como centavos faria a tela anunciar R$ 500,00 para uma empresa de R$ 50 mil —
 * e o filtro "capital acima de R$ 50 mil" não acharia ninguém. O `Math.round`
 * existe porque o valor às vezes vem com decimal.
 */
function capitalToCents(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** `"2015-03-22"` → Date-safe string, ou `null`. */
function normDate(raw) {
  const s = String(raw || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function toDraft(json) {
  const cnpj = N.normalizeCnpj(json?.cnpj);
  if (!cnpj) return null;

  const legal = String(json.razao_social || "").trim() || null;
  const trade = String(json.nome_fantasia || "").trim() || null;

  const mainCnae = String(json.cnae_fiscal || "").replace(/\D/g, "").slice(0, 7) || null;
  const secondary = Array.isArray(json.cnaes_secundarios)
    ? json.cnaes_secundarios
        .map((c) => String(c?.codigo || "").replace(/\D/g, "").slice(0, 7))
        .filter(Boolean)
        .slice(0, 30)
    : [];

  const website = N.normalizeWebsite(json.website || null);
  // A API traz DDD e número separados, e em dois pares (o segundo é raro).
  const phone = N.normalizePhone(
    `${json.ddd_telefone_1 || ""}`.replace(/\D/g, "") ||
      `${json.ddd_telefone_2 || ""}`.replace(/\D/g, "")
  );

  const city = String(json.municipio || "").trim() || null;

  const fields = {
    cnpj,
    legal_name: legal,
    trade_name: trade,
    // ⚠️ O NOME DE TELA PREFERE O FANTASIA. Razão social é o que está no
    // contrato social ("J. R. COMERCIO DE ALIMENTOS LTDA"); fantasia é o que
    // está na placa ("Padaria Doze"), e é o que o vendedor reconhece.
    display_name: trade || legal,
    main_cnae: mainCnae,
    cnae_list: secondary,
    category_key: categoryFromCnae(mainCnae),
    company_size: normSize(json.porte, json.codigo_porte),
    legal_nature: String(json.codigo_natureza_juridica || "").replace(/\D/g, "").slice(0, 8) || null,
    share_capital_cents: capitalToCents(json.capital_social),
    opened_at: normDate(json.data_inicio_atividade),
    reg_status: normStatus(json.descricao_situacao_cadastral),
    // `identificador_matriz_filial`: 1 = matriz, 2 = filial.
    is_headquarters:
      json.identificador_matriz_filial === undefined || json.identificador_matriz_filial === null
        ? null
        : Number(json.identificador_matriz_filial) === 1,
    address: [json.descricao_tipo_de_logradouro, json.logradouro]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join(" ") || null,
    address_number: String(json.numero || "").trim().slice(0, 20) || null,
    complement: String(json.complemento || "").trim() || null,
    neighborhood: String(json.bairro || "").trim() || null,
    city,
    uf: String(json.uf || "").trim().toUpperCase().slice(0, 2) || null,
    zip_code: N.normalizeZip(json.cep),
    email: N.normalizeEmail(json.email),
    phone,
    whatsapp: N.isMobilePhone(phone) ? phone : null,
    website,
    domain: N.normalizeDomain(website),
  };

  return { fields, source_url: `${BASE}/${cnpj}` };
}

/**
 * Consulta um CNPJ.
 *
 * ⚠️ VALIDA O DÍGITO VERIFICADOR ANTES DE IR À REDE. CNPJ torto não existe em
 * cadastro nenhum, e perguntar por ele gasta uma chamada da cota pública
 * compartilhada para receber 404.
 *
 * ⚠️ 404 NÃO É ERRO — é resposta. Devolve `null` e o worker marca a empresa
 * como "conferida, sem CNPJ": sem essa distinção, ela voltaria para a fila
 * eternamente tentando o mesmo CNPJ inexistente.
 */
async function lookup(rawCnpj) {
  if (!isConfigured()) return null;
  const cnpj = N.normalizeCnpj(rawCnpj);
  if (!cnpj || !N.isValidCnpj(cnpj)) return null;
  try {
    const res = await fetch(`${BASE}/${cnpj}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (res.status === 429) {
      // Distinguir "não existe" de "fui limitado" é o que permite ao worker
      // reagendar em vez de marcar a empresa como sem CNPJ para sempre.
      const err = new Error("cnpj_rate_limited");
      err.retryable = true;
      throw err;
    }
    if (!res.ok) {
      log.warn("cnpj.http_error", { status: res.status });
      return null;
    }
    return toDraft(await res.json());
  } catch (err) {
    if (err?.retryable) throw err;
    log.warn("cnpj.fetch_fail", { message: err?.message });
    return null;
  }
}

/**
 * Enriquece uma empresa QUE JÁ TEM CNPJ.
 *
 * ⚠️ ESTA FONTE NÃO DESCOBRE CNPJ. A API é endereçada POR CNPJ — não existe
 * "qual é o CNPJ da Academia Corpo e Ação?". Quem traz o CNPJ é o OSM
 * (`ref:vatin`, raro) ou o site oficial (rodapé, comum). Sem CNPJ, este
 * provider devolve `null` em vez de fingir que tentou.
 */
async function enrich(company) {
  if (!company?.cnpj) return null;
  return lookup(company.cnpj);
}

module.exports = {
  source: "cnpj",
  label: "Dados abertos de CNPJ",
  capabilities: { discover: false, enrich: true },
  isConfigured,
  lookup,
  enrich,
  toDraft,
  capitalToCents,
  normStatus,
  normSize,
};
