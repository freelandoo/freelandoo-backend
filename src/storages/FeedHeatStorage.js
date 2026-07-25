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

// Piso anti-ruído: num dia parado, a média cai tanto que 1 visualização solta
// ficaria "acima da média" e o feed inteiro brilharia. Precisa de um mínimo de
// tração absoluta pra contar como "em alta".
const MIN_HEAT = 5;

// Teto de linhas devolvidas — o conjunto quente é naturalmente pequeno; o LIMIT
// é só blindagem contra um dia anômalo.
const MAX_HOT = 500;

module.exports = {
  HEAT_WINDOW,
  LIKE_WEIGHT,
  MIN_HEAT,

  /**
   * Posts acima da média do dia. Devolve `[{ post_id, heat, day_avg }]`.
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
        SELECT post_id, heat, AVG(heat) OVER () AS day_avg FROM heat
      )
      SELECT post_id, heat::int AS heat, ROUND(day_avg, 2)::float8 AS day_avg
        FROM scored
       WHERE heat > day_avg
         AND heat >= $1
       ORDER BY heat DESC
       LIMIT ${MAX_HOT}
      `,
      [MIN_HEAT]
    );
    return r.rows;
  },
};
