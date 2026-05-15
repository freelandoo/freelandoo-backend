const LIST_QUERY = `
  SELECT
    c.id_portfolio_comment,
    c.id_portfolio_item,
    c.id_user,
    c.content,
    c.created_at,
    c.updated_at,
    u.username,
    u.nome AS user_display_name,
    upa.avatar_url AS user_avatar_url
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
   */
  async listForItem(db, { id_portfolio_item, cursor = null, limit = 20 }) {
    const r = await db.query(LIST_QUERY, [
      id_portfolio_item,
      cursor || null,
      Math.min(Math.max(limit, 1), 50),
    ]);
    return r.rows;
  },

  async getById(db, id_portfolio_comment) {
    const r = await db.query(
      `SELECT id_portfolio_comment, id_portfolio_item, id_user, content,
              is_active, created_at, updated_at
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
                 created_at, updated_at`,
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

  async getEnrichedById(db, id_portfolio_comment) {
    const r = await db.query(
      `SELECT
         c.id_portfolio_comment,
         c.id_portfolio_item,
         c.id_user,
         c.content,
         c.created_at,
         c.updated_at,
         u.username,
         u.nome AS user_display_name,
         upa.avatar_url AS user_avatar_url
       FROM public.tb_portfolio_comment c
       JOIN public.tb_user u ON u.id_user = c.id_user
       LEFT JOIN public.tb_profile upa
         ON upa.id_user = c.id_user
        AND upa.is_user_account = TRUE
       WHERE c.id_portfolio_comment = $1`,
      [id_portfolio_comment]
    );
    return r.rowCount ? r.rows[0] : null;
  },
};

module.exports = PortfolioCommentStorage;
