// src/utils/gamesScore.js
//
// A RÉGUA DO RANKING DA PLATAFORMA DE GAMES — fonte única.
//
// Pedido do Alex (2026-09-07): o ranking de games passa a usar as métricas que
// já existem no resto da plataforma (curtida, comentário, compartilhamento),
// contadas SÓ pelo que acontece dentro da plataforma de games, mais o tempo
// online lá dentro — e a fila é por CIDADE e ESTADO, não global.
//
// ─── POR QUE ISTO É UM ARQUIVO, E NÃO SQL SOLTO EM CADA CONSULTA ────────────
//
// O ranking é lido em DOIS lugares na mesma tela: a fila (o pódio e a lista) e
// a linha "sua posição" de quem está olhando. Duas contas escritas à mão
// divergiriam no primeiro ajuste de peso, e o sintoma seria a tela dizendo que
// a pessoa é 7ª numa linha e mostrando outra pessoa em 7º logo acima. Por isso
// os pesos, o teto e o recorte de "o que é post de games" moram aqui e são
// interpolados nas duas consultas.
//
// ─── OS PESOS ───────────────────────────────────────────────────────────────
//
// São os MESMOS do score do bee (BeeEngagementStorage): curtida 1, comentário
// 2, compartilhamento 3. Não foram inventados aqui de propósito — a plataforma
// já respondeu uma vez "quanto vale cada gesto", e uma segunda resposta faria
// o mesmo post valer coisas diferentes em duas telas.
//
// O tempo é a régua nova, e a escolha é 1 ponto a cada 10 MINUTOS (6 pontos por
// hora). A conta por trás: com o teto diário de 6h, a presença rende no máximo
// 36 pontos por dia — mais do que uma curtida, muito menos do que um post que
// engaja. Presença tinha que contar sem ser o que decide a fila; quem só deixa
// a aba aberta não pode ganhar de quem publica.
//
// ─── O QUE CONTA COMO "DENTRO DA PLATAFORMA GAMES" ──────────────────────────
//
// Um post é de games quando está vinculado ao feed de uma comunidade de
// modalidade `games` (tb_community_feed_item, mig 160). Nada de "o autor tem
// uma comunidade de games": isso contaria o post que a pessoa publicou no feed
// geral, que não é da plataforma de games e já pontua no ranking geral.
//
// O predicado é UM SÓ (GAMES_ITEM_SQL) e é usado pelas três métricas de
// engajamento. Escrito três vezes, o dia em que uma delas mudasse produziria
// uma tela onde a curtida conta um post que o compartilhamento jura não
// existir.

/** Pesos de engajamento — os mesmos do score do bee. */
const WEIGHTS = Object.freeze({ like: 1, comment: 2, share: 3 });

/** 10 minutos online = 1 ponto. Ver o raciocínio no cabeçalho. */
const SECONDS_PER_POINT = 600;

/**
 * Teto de uma batida, em segundos.
 *
 * O cliente bate a cada 120s; 180 dá folga para aba lenta, rede ruim e o
 * atraso de um `setTimeout` que o navegador segurou. Acima disso o crédito é
 * cortado: quem volta depois de horas ganha uma batida, não as horas.
 */
const MAX_BEAT_SECONDS = 180;

/**
 * Teto diário, em segundos (6 horas).
 *
 * Existe porque o sinal é presença, não resistência. Sem ele, a fila mediria
 * quem deixou a aba aberta — e o primeiro lugar seria de um computador, não de
 * uma pessoa.
 */
const DAILY_CAP_SECONDS = 6 * 3600;

/**
 * O item de portfólio está vinculado ao feed de uma comunidade DAQUELA
 * modalidade?
 *
 * Recebe o alias da tabela de itens já em escopo (ex.: "it") e devolve um
 * EXISTS pronto. Correlato de propósito: o planejador resolve por índice
 * (ux_community_feed_item) em vez de materializar a lista inteira de posts a
 * cada consulta.
 *
 * ⚠️ O `kind` entra como LITERAL, e por isso passa por uma lista fechada: ele é
 * interpolado no texto do SQL, e um valor vindo de fora sem essa trava seria
 * injeção. Não vira parâmetro `$n` pela razão de sempre neste arquivo — o mesmo
 * placeholder valendo como coluna e dentro de expressão já custou o 42P08 três
 * vezes aqui.
 *
 * Serve games (mig 226) e o Financeiro (mig 229). Plataforma nova = acrescentar
 * a modalidade em PLATFORM_KINDS; a conta, os pesos e o resto vêm de graça.
 */
const PLATFORM_KINDS = Object.freeze(["games", "finance"]);

function platformItemSql(itemAlias, kind) {
  if (!PLATFORM_KINDS.includes(kind)) {
    throw new Error(`platformItemSql: modalidade não suportada: ${kind}`);
  }
  return `EXISTS (
            SELECT 1
              FROM public.tb_community_feed_item cfi
              JOIN public.tb_profile cprof
                ON cprof.id_profile = cfi.id_community_profile
             WHERE cfi.id_portfolio_item = ${itemAlias}.id_portfolio_item
               AND cprof.community_kind = '${kind}'
          )`;
}

/** Atalho histórico — games era a única plataforma quando isto nasceu. */
function gamesItemSql(itemAlias) {
  return platformItemSql(itemAlias, "games");
}

/**
 * O recorte geográfico da fila.
 *
 * ⚠️ É FRAGMENTO DE SQL ESCOLHIDO NO JS, e não um parâmetro comparado dentro de
 * um CASE. O mesmo parâmetro valendo como coluna e como comparação dentro de
 * expressão já custou o erro 42P08 três vezes neste projeto (migs 202–204 e
 * 224): o Postgres deduz dois tipos para o mesmo `$n` e recusa a query inteira.
 * Escolher o texto aqui elimina a ambiguidade antes de ela existir.
 *
 * Cidade é sempre CIDADE + ESTADO: existe Campinas em São Paulo e Campinas no
 * Rio de Janeiro, e uma fila só por nome juntaria as duas.
 */
function scopeSql(scope, profileAlias) {
  const p = profileAlias;
  if (scope === "state") {
    return `lower(${p}.estado) = lower(me.estado)`;
  }
  return `lower(${p}.estado) = lower(me.estado)
      AND lower(${p}.municipio) = lower(me.municipio)`;
}

/** Escopos aceitos. Qualquer outra coisa cai em "city". */
const SCOPES = Object.freeze(["city", "state"]);

function normalizeScope(scope) {
  return SCOPES.includes(scope) ? scope : "city";
}

/**
 * A expressão de pontuação, para ser usada dentro de um SELECT que já tenha as
 * colunas `likes`, `comments`, `shares` e `seconds` em escopo.
 *
 * A divisão do tempo é INTEIRA (`/` entre inteiros no Postgres já trunca): 9
 * minutos online valem zero, e é o certo — o ponto é a unidade, e arredondar
 * para cima daria um ponto a quem só passou pela tela.
 */
function scoreSql({ likes = "likes", comments = "comments", shares = "shares", seconds = "seconds" } = {}) {
  return `(
            COALESCE(${likes}, 0)    * ${WEIGHTS.like}
          + COALESCE(${comments}, 0) * ${WEIGHTS.comment}
          + COALESCE(${shares}, 0)   * ${WEIGHTS.share}
          + COALESCE(${seconds}, 0)  / ${SECONDS_PER_POINT}
          )`;
}

module.exports = {
  WEIGHTS,
  PLATFORM_KINDS,
  platformItemSql,
  SECONDS_PER_POINT,
  MAX_BEAT_SECONDS,
  DAILY_CAP_SECONDS,
  SCOPES,
  normalizeScope,
  gamesItemSql,
  scopeSql,
  scoreSql,
};
