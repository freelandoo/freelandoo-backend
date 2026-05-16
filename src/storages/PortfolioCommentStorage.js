const LIST_QUERY = `
  SELECT
    c.id_portfolio_comment,
    c.id_portfolio_item,
    c.id_user,
    c.content,
    c.created_at,
    c.updated_at,
    c.likes_count,
    u.username,
    u.nome AS user_display_name,
    upa.avatar_url AS user_avatar_url,
    CASE
      WHEN $4::uuid IS NULL THEN FALSE
      ELSE EXISTS (
        SELECT 1 FROM public.tb_portfolio_comment_like cl
         WHERE cl.id_portfolio_comment = c.id_portfolio_comment
           AND cl.id_user = $4::uuid
      )
    END AS viewer_has_liked
  FROM public.tb_portfolio_comment c
  JOIN public.tb_user u ON u.id_user = c.id_user
  LEFT JOIN public.tb_profile upa
    ON upa.id_user = c.id_user
   AND upa.is_user_account = TRUE
  WHERE c.id_portfolio_item = $1
    AND c.is_active = TRUE
    AND ($2::timestamptz IS NULL OR c.created_at < $2::timestamptz)
  ORDER BY c.created_at DESC, c.id_portfolio_comment DESC
  LIMIT $3
`;

const PortfolioCommentStorage = {
  /**
   * Lista comentários do item por ordem cronológica reversa (mais novo primeiro).
   * Cursor = ISO timestamp do último item da página anterior.
   * viewer_id_user opcional — quando informado, retorna viewer_has_liked.
   */
  async listForItem(db, { id_portfolio_item, cursor = null, limit = 20, viewer_id_user = null }) {
    const r = await db.query(LIST_QUERY, [
      id_portfolio_item,
      cursor || null,
      Math.min(Math.max(limit, 1), 50),
      viewer_id_user || null,
    ]);
    return r.rows;
  },

  async getById(db, id_portfolio_comment) {
    const r = await db.query(
      `SELECT id_portfolio_comment, id_portfolio_item, id_user, content,
              is_active, created_at, updated_at, likes_count
       FROM public.tb_portfolio_comment
       WHERE id_portfolio_comment = $1 AND is_active = TRUE
       LIMIT 1`,
      [id_portfolio_comment]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async itemExists(db, id_portfolio_item) {
    const r = await db.query(
      `SELECT 1 FROM public.tb_profile_portfolio_item
        WHERE id_portfolio_item = $1
          AND is_active = TRUE
          AND status = 'published'
        LIMIT 1`,
      [id_portfolio_item]
    );
    return r.rowCount > 0;
  },

  async create(db, { id_portfolio_item, id_user, content }) {
    const r = await db.query(
      `INSERT INTO public.tb_portfolio_comment
         (id_portfolio_item, id_user, content)
       VALUES ($1, $2, $3)
       RETURNING id_portfolio_comment, id_portfolio_item, id_user, content,
                 created_at, updated_at, likes_count`,
      [id_portfolio_item, id_user, content]
    );
    return r.rows[0];
  },

  async deactivate(db, id_portfolio_comment) {
    const r = await db.query(
      `UPDATE public.tb_portfolio_comment
          SET is_active = FALSE, updated_at = NOW()
        WHERE id_portfolio_comment = $1
          AND is_active = TRUE
        RETURNING id_portfolio_item`,
      [id_portfolio_comment]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async bumpItemCounter(db, id_portfolio_item, delta) {
    await db.query(
      `UPDATE public.tb_profile_portfolio_item
          SET comments_count = GREATEST(0, comments_count + $2)
        WHERE id_portfolio_item = $1`,
      [id_portfolio_item, delta]
    );
  },

  async getEnrichedById(db, id_portfolio_comment, viewer_id_user = null) {
    const r = await db.query(
      `SELECT
         c.id_portfolio_comment,
         c.id_portfolio_item,
         c.id_user,
         c.content,
         c.created_at,
         c.updated_at,
         c.likes_count,
         u.username,
         u.nome AS user_display_name,
         upa.avatar_url AS user_avatar_url,
         CASE
           WHEN $2::uuid IS NULL THEN FALSE
           ELSE EXISTS (
             SELECT 1 FROM public.tb_portfolio_comment_like cl
              WHERE cl.id_portfolio_comment = c.id_portfolio_comment
                AND cl.id_user = $2::uuid
           )
         END AS viewer_has_liked
       FROM public.tb_portfolio_comment c
       JOIN public.tb_user u ON u.id_user = c.id_user
       LEFT JOIN public.tb_profile upa
         ON upa.id_user = c.id_user
        AND upa.is_user_account = TRUE
       WHERE c.id_portfolio_comment = $1`,
      [id_portfolio_comment, viewer_id_user || null]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  /**
   * Toggle de like em comentário. Transacional + idempotente:
   * INSERT ... ON CONFLICT DO NOTHING devolve rowCount=1 quando criou.
   * Quando rowCount=0, faz DELETE. likes_count é recomputado a partir da
   * tabela de likes (defensivo contra drift).
   */
  async toggleLike(db, { id_portfolio_comment, id_user }) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const ins = await client.query(
        `INSERT INTO public.tb_portfolio_comment_like (id_portfolio_comment, id_user)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id_portfolio_comment, id_user]
      );

      let liked;
      if (ins.rowCount === 1) {
        liked = true;
      } else {
        const del = await client.query(
          `DELETE FROM public.tb_portfolio_comment_like
            WHERE id_portfolio_comment = $1 AND id_user = $2`,
          [id_portfolio_comment, id_user]
        );
        liked = del.rowCount === 0; // caso bizarro: nem criou nem existia
      }

      const upd = await client.query(
        `UPDATE public.tb_portfolio_comment c
            SET likes_count = (
              SELECT COUNT(*)::INT FROM public.tb_portfolio_comment_like
               WHERE id_portfolio_comment = c.id_portfolio_comment
            )
          WHERE c.id_portfolio_comment = $1
          RETURNING likes_count`,
        [id_portfolio_comment]
      );

      await client.query("COMMIT");
      return {
        liked,
        likes_count: upd.rows[0]?.likes_count ?? 0,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = PortfolioCommentStorage;
