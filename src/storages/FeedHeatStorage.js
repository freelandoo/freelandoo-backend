// "Calor" de um post: quanto ele está recebendo AGORA, comparado com os outros
// posts em circulação no mesmo dia. Alimenta o anel brilhante no avatar do card
// do feed (só naquele post) — o equivalente visual do anel neon de bees.
//
// Por que 24h e não o contador acumulado: `likes_count`/`impressions_count` são
// vitalícios, então um post de meses atrás sempre venceria o que está bombando
// hoje. O sinal aqui é de MOMENTO — a idade do post não importa.

// Janela do "dia".
const HEAT_WINDOW = "24 hours";

// Um like é ordens de grandeza mais raro que uma visualização (o usuário precisa
// decidir clicar), então vale por várias. Sem esse peso o calor seria só
// visualização e likes praticamente não mexeriam no resultado.
const LIKE_WEIGHT = 10;

// Piso anti-ruído: uma visualização solta não é "em alta". Um like já passa
// (vale 10), então o primeiro post curtido do dia acende — que é a regra do
// Alex: os que mais receberam likes/views no dia sempre acendem.
const MIN_HEAT = 5;

// Os N mais quentes do dia acendem SEMPRE (desde que passem do piso), mesmo
// sendo os únicos com movimento. Sem isso, "acima da média" apagava justamente
// o líder quando ele era o único ativo — ele É a média nesse caso.
const TOP_RANK = 3;

// Teto de linhas devolvidas — o conjunto quente é naturalmente pequeno; o LIMIT
// é só blindagem contra um dia anômalo.
const MAX_HOT = 500;

module.exports = {
  HEAT_WINDOW,
  LIKE_WEIGHT,
  MIN_HEAT,
  TOP_RANK,

  /**
   * Posts "em alta" do dia. Devolve `[{ post_id, heat, day_avg, rank }]`.
   *
   * Acende quem for líder do dia (top 3) OU estiver acima da média — sempre
   * respeitando o piso. O braço do top garante a regra do Alex: quem tem mais
   * likes/views no dia acende, inclusive quando é o único com movimento. O
   * braço da média é o que escala: em dia cheio, todo mundo acima dela acende,
   * não só três.
   *
   * "Os outros" = os posts que tiveram ALGUMA atividade na janela. Post
   * publicado e parado não entra no denominador — senão a média tenderia a
   * zero e qualquer coisa passaria dela.
   */
  async listHotPosts(db) {
    const r = await db.query(
      `
      WITH views AS (
        SELECT id_portfolio_item AS post_id, COUNT(*)::int AS n
          FROM tb_portfolio_event
         WHERE event_type = 'impression'
           AND created_at >= NOW() - INTERVAL '${HEAT_WINDOW}'
         GROUP BY 1
      ),
      likes AS (
        SELECT id_portfolio_item AS post_id, COUNT(*)::int AS n
          FROM portfolio_likes
         WHERE liked_at >= NOW() - INTERVAL '${HEAT_WINDOW}'
         GROUP BY 1
      ),
      heat AS (
        SELECT
          COALESCE(v.post_id, l.post_id)                        AS post_id,
          COALESCE(v.n, 0) + COALESCE(l.n, 0) * ${LIKE_WEIGHT}  AS heat
        FROM views v
        FULL OUTER JOIN likes l ON l.post_id = v.post_id
      ),
      scored AS (
        SELECT
          post_id,
          heat,
          AVG(heat) OVER ()                              AS day_avg,
          ROW_NUMBER() OVER (ORDER BY heat DESC, post_id) AS rank
        FROM heat
      )
      SELECT post_id,
             heat::int                  AS heat,
             ROUND(day_avg, 2)::float8  AS day_avg,
             rank::int                  AS rank
        FROM scored
       WHERE heat >= $1
         AND (rank <= ${TOP_RANK} OR heat > day_avg)
       ORDER BY heat DESC
       LIMIT ${MAX_HOT}
      `,
      [MIN_HEAT]
    );
    return r.rows;
  },
};
