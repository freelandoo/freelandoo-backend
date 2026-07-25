// "Calor" de um post: quanto ele recebeu HOJE, comparado com o líder do dia.
// Alimenta o anel brilhante no avatar do card do feed (só naquele post).
//
// Por que 24h e não o contador acumulado: `likes_count`/`impressions_count` são
// vitalícios, então um post de meses atrás sempre venceria o que está bombando
// hoje. O sinal aqui é de MOMENTO — a idade do post não importa.

// Janela do "dia".
const HEAT_WINDOW = "24 hours";

// Engajamento = views + likes + comentários + salvos, **peso 1 em tudo**.
// Fórmula do Alex: 10.000 views + 1.000 likes + 100 comentários + 10 salvos
// = 11.110. Consequência assumida: como view é ordens de grandeza mais comum,
// o número é dominado por alcance — likes/comentários quase não movem o
// ponteiro num post com muita visualização.
const SIGNALS = ["views", "likes", "comments", "saves"];

// Faixa do brilho: o líder do dia e todo mundo até 10% abaixo dele acendem.
const BAND = 0.9;

// Tolerância ABSOLUTA, somada à faixa percentual. Sem ela a regra quebra em
// número pequeno: com líder em 3, os 10% dão 2,7 e — como engajamento é
// inteiro — só quem EMPATA com o líder acende. Na prática um post ficava de
// fora por uma única impressão de diferença, que é ruído, não mérito.
// Vale o critério mais generoso dos dois: perto de zero manda o SLACK, em
// número grande manda a porcentagem (com líder em 11.110, 1 não muda nada).
const SLACK = 1;

// Piso anti-ruído: menos que isso não é "dia", é uma visualização perdida.
// Baixo de propósito — um post com 1 visualização + 1 like já é líder legítimo
// num dia parado, e o Alex quer que o líder SEMPRE acenda.
const MIN_HEAT = 2;

// Teto de linhas devolvidas — o conjunto quente é naturalmente pequeno; o LIMIT
// é só blindagem contra um dia anômalo.
const MAX_HOT = 500;

module.exports = {
  HEAT_WINDOW,
  SIGNALS,
  BAND,
  SLACK,
  MIN_HEAT,

  /**
   * Posts em alta hoje. Devolve `[{ post_id, heat, leader_heat, tier }]`,
   * `tier` sendo:
   *   - 'leader'  → maior engajamento do dia (empate conta como líder);
   *   - 'rising'  → dentro da faixa abaixo do líder (10% OU 1 ponto, o que
   *                 for mais generoso — ver SLACK).
   *
   * Sem média: a régua é o líder. Foi decisão do Alex depois de ver que
   * "acima da média" apagava o próprio líder quando ele era o único com
   * movimento no dia (ele É a média nesse caso).
   */
  async listHotPosts(db) {
    const r = await db.query(
      `
      WITH sinais AS (
        SELECT id_portfolio_item AS post_id, COUNT(*)::int AS n
          FROM tb_portfolio_event
         WHERE event_type = 'impression'
           AND created_at >= NOW() - INTERVAL '${HEAT_WINDOW}'
         GROUP BY 1

        UNION ALL

        SELECT id_portfolio_item, COUNT(*)::int
          FROM portfolio_likes
         WHERE liked_at >= NOW() - INTERVAL '${HEAT_WINDOW}'
         GROUP BY 1

        UNION ALL

        SELECT id_portfolio_item, COUNT(*)::int
          FROM tb_portfolio_comment
         WHERE is_active = TRUE
           AND created_at >= NOW() - INTERVAL '${HEAT_WINDOW}'
         GROUP BY 1

        UNION ALL

        SELECT id_portfolio_item, COUNT(*)::int
          FROM user_bookmark_item
         WHERE created_at >= NOW() - INTERVAL '${HEAT_WINDOW}'
         GROUP BY 1
      ),
      heat AS (
        SELECT post_id, SUM(n)::int AS heat FROM sinais GROUP BY post_id
      ),
      lider AS (
        SELECT MAX(heat) AS leader_heat FROM heat
      )
      SELECT
        h.post_id,
        h.heat,
        l.leader_heat,
        CASE WHEN h.heat >= l.leader_heat THEN 'leader' ELSE 'rising' END AS tier
      FROM heat h
      CROSS JOIN lider l
      WHERE h.heat >= $1
        -- ::numeric obrigatório: sem ele o Postgres infere $2 como integer
        -- (leader_heat é int) e estoura com "invalid input syntax" no 0.9.
        AND (
          h.heat >= l.leader_heat * $2::numeric
          OR h.heat >= l.leader_heat - $3
        )
      ORDER BY h.heat DESC, h.post_id
      LIMIT ${MAX_HOT}
      `,
      [MIN_HEAT, BAND, SLACK]
    );
    return r.rows;
  },
};
