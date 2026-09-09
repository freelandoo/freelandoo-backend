// src/storages/GamesActivityStorage.js
//
// O RANKING DE ATIVIDADE DA PLATAFORMA DE GAMES (mig 226) — por cidade e por
// estado, contando só o que acontece dentro da plataforma de games.
//
// ─── POR QUE ESTE ARQUIVO NÃO É O GameProfileStorage ────────────────────────
//
// Aquele responde "o que a Steam verificou": biblioteca, horas, conquistas — a
// régua da CONTA CONECTADA. Este responde "o que a pessoa fez aqui dentro": o
// que os outros fizeram com os posts dela e quanto tempo ela passou no
// ambiente. São duas perguntas, com duas fontes e dois donos; juntá-las num
// arquivo faria a mudança de peso de uma mexer na leitura da outra.
//
// ─── O RECORTE É SEMPRE GEOGRÁFICO ──────────────────────────────────────────
//
// Não existe fila global aqui (decisão do Alex): "cria o ranking ali por cidade
// e estado apenas". Cidade e estado saem do PERFIL-CONTA, que é onde o
// onboarding (mig 200) grava — não de um campo novo, que seria uma segunda
// verdade sobre onde a pessoa mora.
//
// ─── QUEM NÃO DECLAROU CIDADE ───────────────────────────────────────────────
//
// Não entra e não é comparado com ninguém. A tela recebe null e escreve o que
// FAZER (declarar a cidade), em vez de um pódio de estranhos ou um zero — a
// mesma escolha da linha "sua posição" do ranking de horas.

const GamesScore = require("../utils/gamesScore");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("GamesActivityStorage");

/** O fuso do "dia" da presença. O mesmo do painel de engajamento. */
const TZ = "America/Sao_Paulo";

/**
 * As CTEs comuns às duas leituras (a fila e a linha de quem olha).
 *
 * Sai daqui em vez de ser escrita duas vezes porque as duas contas TÊM que ser
 * a mesma: com uma cópia, o primeiro ajuste de peso deixaria a lista dizendo um
 * lugar e a linha de baixo dizendo outro — duas contas do mesmo lugar na mesma
 * tela, que é exatamente o defeito que o RANK() do ranking de horas existe para
 * evitar.
 *
 * AUTOENGAJAMENTO NÃO PONTUA. Curtida, comentário e compartilhamento do próprio
 * autor ficam de fora nas três métricas. O que a fila mede é o que os OUTROS
 * fizeram com o conteúdo — sem isso, o primeiro lugar seria de quem clicasse
 * mais vezes no próprio botão de compartilhar.
 *
 * $1 = id_user de quem está olhando (define cidade/estado do recorte).
 */
function commonCte(scope) {
  const games = GamesScore.gamesItemSql("it");
  const where = GamesScore.scopeSql(scope, "p");
  return `
  WITH me AS (
    SELECT p.municipio, p.estado
      FROM public.tb_profile p
     WHERE p.id_user = $1
       AND p.is_user_account = TRUE
       AND p.deleted_at IS NULL
       AND p.municipio IS NOT NULL
       AND p.estado IS NOT NULL
     LIMIT 1
  ),
  peers AS (
    SELECT DISTINCT p.id_user
      FROM public.tb_profile p
      CROSS JOIN me
     WHERE p.is_user_account = TRUE
       AND p.deleted_at IS NULL
       AND p.municipio IS NOT NULL
       AND p.estado IS NOT NULL
       AND ${where}
  ),
  ev_likes AS (
    SELECT op.id_user, COUNT(*)::bigint AS n
      FROM public.portfolio_likes l
      JOIN public.tb_profile_portfolio_item it
        ON it.id_portfolio_item = l.id_portfolio_item
      JOIN public.tb_profile op ON op.id_profile = it.id_profile
      JOIN peers ON peers.id_user = op.id_user
     WHERE it.is_active = TRUE
       AND (l.id_user IS NULL OR l.id_user <> op.id_user)
       AND ${games}
     GROUP BY op.id_user
  ),
  ev_comments AS (
    SELECT op.id_user, COUNT(*)::bigint AS n
      FROM public.tb_portfolio_comment c
      JOIN public.tb_profile_portfolio_item it
        ON it.id_portfolio_item = c.id_portfolio_item
      JOIN public.tb_profile op ON op.id_profile = it.id_profile
      JOIN peers ON peers.id_user = op.id_user
     WHERE it.is_active = TRUE
       AND c.is_active = TRUE
       AND c.id_user <> op.id_user
       AND ${games}
     GROUP BY op.id_user
  ),
  ev_shares AS (
    SELECT op.id_user, COUNT(*)::bigint AS n
      FROM public.tb_portfolio_event e
      JOIN public.tb_profile_portfolio_item it
        ON it.id_portfolio_item = e.id_portfolio_item
      JOIN public.tb_profile op ON op.id_profile = it.id_profile
      JOIN peers ON peers.id_user = op.id_user
     WHERE e.event_type = 'share'
       AND it.is_active = TRUE
       AND (e.id_user IS NULL OR e.id_user <> op.id_user)
       AND ${games}
     GROUP BY op.id_user
  ),
  ev_presence AS (
    SELECT g.id_user, SUM(g.seconds)::bigint AS seconds
      FROM public.tb_games_presence g
      JOIN peers ON peers.id_user = g.id_user
     GROUP BY g.id_user
  ),
  totals AS (
    SELECT peers.id_user,
           COALESCE(l.n, 0)         AS likes,
           COALESCE(c.n, 0)         AS comments,
           COALESCE(s.n, 0)         AS shares,
           COALESCE(pr.seconds, 0)  AS seconds
      FROM peers
      LEFT JOIN ev_likes    l  ON l.id_user  = peers.id_user
      LEFT JOIN ev_comments c  ON c.id_user  = peers.id_user
      LEFT JOIN ev_shares   s  ON s.id_user  = peers.id_user
      LEFT JOIN ev_presence pr ON pr.id_user = peers.id_user
  ),
  scored AS (
    SELECT t.*, ${GamesScore.scoreSql()}::bigint AS score
      FROM totals t
  ),
  ranked AS (
    SELECT sc.*,
           RANK() OVER (ORDER BY sc.score DESC)::int AS position,
           (COUNT(*) OVER ())::int                   AS total
      FROM scored sc
     WHERE sc.score > 0
  )`;
}

module.exports = {
  /**
   * A batida de presença.
   *
   * O crédito é calculado AQUI, a partir de last_beat_at, e não vem do cliente:
   * o navegador só diz "ainda estou". Dois tetos, os dois do servidor —
   * MAX_BEAT (quanto uma batida pode valer) e DAILY_CAP (quanto um dia inteiro
   * pode valer).
   *
   * A primeira batida do dia entra com zero: presença é o que foi MEDIDO entre
   * duas batidas, e antes da primeira não houve medida nenhuma.
   *
   * O fuso e os tetos entram como LITERAIS interpolados de constantes do
   * código, não como parâmetros: o mesmo $n valendo como valor de coluna e
   * dentro de expressão já custou o 42P08 três vezes neste projeto. Como os
   * três vêm de utils/gamesScore.js (números e uma constante nossa), não há
   * entrada de usuário no texto da query.
   */
  async beat(conn, id_user, { resume = false } = {}) {
    // A parcela creditada é ESCOLHIDA AQUI, no JS, e não por um parâmetro
    // comparado dentro da expressão — mesma disciplina do escopo do ranking
    // (ver o 42P08 em utils/gamesScore.js). "resume" credita zero: serve para o
    // retorno de uma aba escondida, onde o intervalo entre batidas não é tempo
    // de ninguém.
    const credito = resume
      ? "0"
      : `LEAST(
           GREATEST(
             EXTRACT(EPOCH FROM (NOW() - public.tb_games_presence.last_beat_at))::int,
             0
           ),
           ${GamesScore.MAX_BEAT_SECONDS}
         )`;
    return runWithLogs(log, "beat", () => ({ id_user, resume }), async () => {
      const r = await conn.query(
        `INSERT INTO public.tb_games_presence (id_user, day, seconds, last_beat_at)
         VALUES ($1, (NOW() AT TIME ZONE '${TZ}')::date, 0, NOW())
         ON CONFLICT (id_user, day) DO UPDATE
            SET seconds = LEAST(
                            public.tb_games_presence.seconds + ${credito},
                            ${GamesScore.DAILY_CAP_SECONDS}
                          ),
                last_beat_at = NOW()
         RETURNING seconds, day`,
        [id_user]
      );
      return r.rows[0];
    });
  },

  /**
   * Onde a pessoa mora, do jeito que o ranking pergunta.
   *
   * Roda ANTES da fila para separar dois "vazios" que a fila sozinha
   * confundiria: "ninguém pontuou na sua cidade" e "você não disse qual é a sua
   * cidade". O segundo tem conserto, e a tela precisa poder dizer qual.
   */
  async getPlace(conn, id_user) {
    const r = await conn.query(
      `SELECT p.municipio, p.estado
         FROM public.tb_profile p
        WHERE p.id_user = $1
          AND p.is_user_account = TRUE
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [id_user]
    );
    const row = r.rows[0];
    if (!row || !row.municipio || !row.estado) return null;
    return { municipio: row.municipio, estado: row.estado };
  },

  /** A fila: os primeiros da cidade (ou do estado) de quem está olhando. */
  async rankByActivity(conn, { id_user, scope, limit }) {
    return runWithLogs(log, "rankByActivity", () => ({ id_user, scope, limit }), async () => {
      const r = await conn.query(
        `${commonCte(scope)}
         SELECT r.id_user, r.position, r.total,
                r.likes, r.comments, r.shares, r.seconds, r.score,
                u.username, u.nome, u.avatar
           FROM ranked r
           JOIN public.tb_user u ON u.id_user = r.id_user
          ORDER BY r.position ASC, u.username ASC
          LIMIT $2`,
        [id_user, limit]
      );
      return r.rows;
    });
  },

  /**
   * A linha de quem está olhando, mesmo fora do topo.
   *
   * Devolve null para quem ainda não pontuou — e aí a tela diz o que fazer, em
   * vez de mostrar um zero. Zero na fila parece nota baixa; o que existe é
   * ausência de atividade.
   */
  async getActivityRank(conn, { id_user, scope }) {
    const r = await conn.query(
      `${commonCte(scope)}
       SELECT r.position, r.total, r.likes, r.comments, r.shares, r.seconds, r.score,
              u.username, u.nome, u.avatar
         FROM ranked r
         JOIN public.tb_user u ON u.id_user = r.id_user
        WHERE r.id_user = $1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  },
};
