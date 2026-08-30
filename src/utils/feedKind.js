// Fonte única do feed_kind de um item de portfólio (mig 053 + mig 209).
//
//   'feed'   → post visual 4:5 (imagem/vídeo)
//   'bees'   → Curto (vídeo 9:16)
//   'recado' → post SÓ-TEXTO, zero mídia (mig 209)
//
// ATENÇÃO — a regra que não pode regredir: quem pede a aba de POSTS pede
// `feed` e tem que receber TAMBÉM os recados (recado é post, só que de texto).
// Quem pede `recado` recebe só recado. Por isso o predicado NÃO é `= $n`:
// use sempre `feedKindMatchSql()` em vez de escrever a comparação na mão —
// foi assim que a aba Portfólio deixaria de mostrar o texto recém-publicado.

const FEED_KINDS = ["feed", "bees", "recado"];

/** Kinds fisicamente casados por um filtro. 'feed' abraça 'recado'. */
const FEED_KIND_EXPANSION = {
  feed: ["feed", "recado"],
  bees: ["bees"],
  recado: ["recado"],
};

/** Normaliza entrada do cliente. Devolve `fallback` (default null = todos). */
function normalizeFeedKind(raw, fallback = null) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (FEED_KINDS.includes(value)) return value;
  return fallback;
}

/** true quando o item de kind `itemKind` deve aparecer no filtro `filterKind`. */
function feedKindMatches(filterKind, itemKind) {
  if (!filterKind) return true;
  return (FEED_KIND_EXPANSION[filterKind] || [filterKind]).includes(itemKind);
}

/**
 * Predicado SQL do filtro de kind. `param` é o placeholder já escrito ($4, $9…).
 * NULL no parâmetro = todos os kinds.
 *
 * O cast `::text` é explícito em toda ocorrência de propósito: o mesmo
 * parâmetro aparece comparado a coluna varchar e a literal text na mesma
 * query, e sem o cast o Postgres estoura 42P08 (armadilha já paga na mig 202).
 */
function feedKindMatchSql(column, param) {
  return `(
    ${param}::text IS NULL
    OR ${column} = ${param}::text
    OR (${param}::text = 'feed' AND ${column} = 'recado')
  )`;
}

module.exports = {
  FEED_KINDS,
  FEED_KIND_EXPANSION,
  normalizeFeedKind,
  feedKindMatches,
  feedKindMatchSql,
};
