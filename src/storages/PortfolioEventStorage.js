// Whitelist event_type → coluna agregada em tb_profile_portfolio_item.
// like/unlike são tratados em /ranking/like (atualizam likes_count lá).
// view_more_caption só registra evento, sem contador.
const COUNTER_BY_EVENT = {
  impression:     "impressions_count",
  share:          "shares_count",
  profile_click:  "profile_clicks_count",
  whatsapp_click: "whatsapp_clicks_count",
  social_click:   "social_clicks_count",
};

// Peso da ação no engagement_score (impressões não pontuam — são sinal de
// distribuição, não engajamento). Mesma fórmula usada no recalc periódico.
const SCORE_DELTA = {
  impressions_count:     0,
  shares_count:          3,
  profile_clicks_count:  4,
  whatsapp_clicks_count: 6,
  social_clicks_count:   2,
};

const IMPRESSION_DEDUP_INTERVAL = "30 minutes";

module.exports = {
  COUNTER_BY_EVENT,

  /**
   * Registra um evento do feed e mantém os contadores agregados +
   * engagement_score em sync, dentro de uma única transação.
   *
   * Para `impression`: dedup por (session_id, post_id) em janela de 30min —
   * só a 1ª impressão da sessão incrementa o contador; as demais ainda são
   * persistidas em tb_portfolio_event para análise.
   */
  async recordEvent(pool, {
    id_portfolio_item,
    event_type,
    session_id,
    id_user,
    filters,
    metadata,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const prof = await client.query(
        `SELECT id_profile
           FROM tb_profile_portfolio_item
          WHERE id_portfolio_item = $1`,
        [id_portfolio_item]
      );
      if (!prof.rows.length) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "post_not_found" };
      }
      const id_profile = prof.rows[0].id_profile;

      let countsTowardCounter = true;
      if (event_type === "impression" && session_id) {
        const dup = await client.query(
          `SELECT 1
             FROM tb_portfolio_event
            WHERE id_portfolio_item = $1
              AND session_id        = $2
              AND event_type        = 'impression'
              AND created_at >= NOW() - INTERVAL '${IMPRESSION_DEDUP_INTERVAL}'
            LIMIT 1`,
          [id_portfolio_item, session_id]
        );
        if (dup.rows.length) countsTowardCounter = false;
      }

      await client.query(
        `INSERT INTO tb_portfolio_event (
           id_portfolio_item, id_profile, id_user, session_id, event_type,
           machine_filter, profession_filter, city_filter, state_filter, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id_portfolio_item,
          id_profile,
          id_user || null,
          session_id || null,
          event_type,
          filters?.machine_id ?? null,
          filters?.profession_id ?? null,
          filters?.city ?? null,
          filters?.state ?? null,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      const counterColumn = COUNTER_BY_EVENT[event_type];
      if (counterColumn && countsTowardCounter) {
        const scoreDelta = SCORE_DELTA[counterColumn] ?? 0;
        // counterColumn vem do whitelist acima, então é seguro interpolar.
        await client.query(
          `UPDATE tb_profile_portfolio_item
              SET ${counterColumn} = ${counterColumn} + 1,
                  engagement_score =
                      likes_count            * 1
                    + shares_count           * 3
                    + profile_clicks_count   * 4
                    + whatsapp_clicks_count  * 6
                    + social_clicks_count    * 2
                    + ${scoreDelta}
            WHERE id_portfolio_item = $1`,
          [id_portfolio_item]
        );
      }

      await client.query("COMMIT");
      return { ok: true, counted: countsTowardCounter, id_profile };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
};
