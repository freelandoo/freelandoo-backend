// src/integrations/companyProvider/index.js
// O REGISTRY das fontes de dados de empresa — a fronteira que mantém os
// services falando com um CONTRATO em vez de `if (source === 'osm')` espalhado.
//
// Mesma disciplina do `gameProvider` (mig 220) e do `payments/contract.js`: foi
// ela que permitiu trocar o gateway de pagamento inteiro sem reescrever o
// service, e é ela que vai receber a fonte seguinte aqui (o dump de CNPJ da
// Receita, um diretório, o que vier) sem reabrir o motor de matching.
//
// ─── O CONTRATO ──────────────────────────────────────────────────────────────
//
//   source       string   — a chave gravada em `tb_company_source.source`.
//                           ⚠️ Tem que estar no CHECK `chk_company_source_kind`
//                           da mig 254 E no mapa de `utils/companyConfidence.js`.
//                           Declarada em menos de três lugares, a fonte ou é
//                           recusada pelo banco ou grava com confiança 0 e nunca
//                           vence ninguém — os dois em silêncio.
//
//   capabilities { discover: bool, enrich: bool }
//                        — ⚠️ CAPACIDADE DECLARADA, NÃO NOME DE PROVEDOR. É o
//                           que deixa o worker perguntar "quem sabe descobrir?"
//                           em vez de conhecer a lista. A Receita não descobre
//                           (não tem coordenada nem busca por categoria); o OSM
//                           não enriquece CNPJ. Quem esquecer de declarar cai no
//                           `false`, que é o lado seguro do erro.
//
//   isConfigured()       — ⚠️ QUEM DECIDE SE A FONTE EXISTE É O AMBIENTE, NÃO A
//                           FLAG. Regra que as migs 214/220 já cravaram: flag
//                           ligada sem credencial produz um botão que só falha
//                           DEPOIS do clique. Fonte sem configuração some da
//                           lista em vez de estourar no meio de uma busca.
//
//   discover(query)      — devolve `CompanyDraft[]` (ver o formato abaixo).
//   enrich(company)      — devolve `CompanyDraft | null` para UMA empresa.
//
// ─── O `CompanyDraft` ────────────────────────────────────────────────────────
//
// É o formato NEUTRO que toda fonte devolve, e é o que permite ao matching e à
// resolução de conflito não conhecerem nenhuma fonte:
//
//   {
//     fields: { phone: "1143301234", website: "https://…", … },  // já normalizado
//     source_url: "https://…",   // de onde veio (vai para a proveniência)
//     osm_ref: "node/123",       // só o OSM
//   }
//
// ⚠️ NORMALIZAR É RESPONSABILIDADE DA FONTE. Cada provider chama
// `utils/companyNormalize` antes de devolver — assim o telefone chega em
// dígitos venha ele de "(11) 4330-1234" ou de "+55 11 4330 1234", e o motor de
// matching nunca precisa saber quem escreveu.

const osm = require("./osm");
const cnpj = require("./cnpj");
const website = require("./website");

const PROVIDERS = Object.freeze({
  [osm.source]: osm,
  [cnpj.source]: cnpj,
  [website.source]: website,
});

/** O provider, ou `null`. Nunca estoura por nome desconhecido. */
function getProvider(source) {
  return PROVIDERS[String(source || "").toLowerCase()] || null;
}

/** Os que sabem DESCOBRIR e estão configurados. */
function discoverProviders() {
  return Object.values(PROVIDERS).filter(
    (p) => p.capabilities?.discover && p.isConfigured()
  );
}

/** Os que sabem ENRIQUECER e estão configurados. */
function enrichProviders() {
  return Object.values(PROVIDERS).filter(
    (p) => p.capabilities?.enrich && p.isConfigured()
  );
}

/** Estado de cada fonte — é o que o painel mostra em vez de adivinhar. */
function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    source: p.source,
    label: p.label,
    configured: p.isConfigured(),
    capabilities: p.capabilities,
  }));
}

module.exports = {
  PROVIDERS,
  getProvider,
  discoverProviders,
  enrichProviders,
  listProviders,
};
