const COMMENT_SELECT = `
  SELECT
    c.id_casa_audience_comment,
    c.external_user_id,
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
        SELECT 1 FROM public.casa_audience_comment_like cl
         WHERE cl.id_casa_audience_comment = c.id_casa_audience_comment
           AND cl.id_user = $4::uuid
      )
    END AS viewer_has_liked
  FROM public.casa_audience_comment c
  JOIN public.tb_user u ON u.id_user = c.id_user
  LEFT JOIN public.tb_profile upa
    ON upa.id_user = c.id_user
   AND upa.is_user_account = TRUE
  WHERE c.external_user_id = $1
    AND c.is_active = TRUE
    AND ($2::timestamptz IS NULL OR c.created_at < $2::timestamptz)
  ORDER BY c.created_at DESC, c.id_casa_audience_comment DESC
  LIMIT $3
`;

const CasaAudienceInteractionStorage = {
  async upsertTarget(db, { external_user_id, user_login = null, avatar_url = null }) {
    const r = await db.query(
      `INSERT INTO public.casa_audience_target
         (external_user_id, user_login, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (external_user_id) DO UPDATE
          SET user_login = COALESCE(EXCLUDED.user_login, public.casa_audience_target.user_login),
              avatar_url = COALESCE(EXCLUDED.avatar_url, public.casa_audience_target.avatar_url),
              last_seen_at = NOW(),
              updated_at = NOW()
       RETURNING external_user_id, user_login, avatar_url, likes_count, comments_count,
                 last_seen_at, created_at, updated_at`,
      [external_user_id, user_login || null, avatar_url || null],
    );
    return r.rows[0] || null;
  },

  async getSummary(db, { external_user_id, viewer_id_user = null }) {
    const r = await db.query(
      `SELECT
         t.external_user_id,
         t.user_login,
         t.avatar_url,
         t.likes_count,
         t.comments_count,
         CASE
           WHEN $2::uuid IS NULL THEN FALSE
           ELSE EXISTS (
             SELECT 1 FROM public.casa_audience_like l
              WHERE l.external_user_id = t.external_user_id
                AND l.id_user = $2::uuid
           )
         END AS viewer_has_liked
       FROM public.casa_audience_target t
       WHERE t.external_user_id = $1
       LIMIT 1`,
      [external_user_id, viewer_id_user || null],
    );
    return r.rows[0] || null;
  },

  async listSummaries(db, { external_user_ids, viewer_id_user = null }) {
    const r = await db.query(
      `SELECT
         x.external_user_id,
         COALESCE(t.likes_count, 0)::INT AS likes_count,
         COALESCE(t.comments_count, 0)::INT AS comments_count,
         CASE
           WHEN $2::uuid IS NULL THEN FALSE
           ELSE EXISTS (
             SELECT 1 FROM public.casa_audience_like l
              WHERE l.external_user_id = x.external_user_id
                AND l.id_user = $2::uuid
           )
         END AS viewer_has_liked
       FROM unnest($1::varchar[]) AS x(external_user_id)
       LEFT JOIN public.casa_audience_target t
         ON t.external_user_id = x.external_user_id`,
      [external_user_ids, viewer_id_user || null],
    );
    return r.rows;
  },

  async listComments(db, { external_user_id, cursor = null, limit = 20, viewer_id_user = null }) {
    const r = await db.query(COMMENT_SELECT, [
      external_user_id,
      cursor || null,
      Math.min(Math.max(limit, 1), 50),
      viewer_id_user || null,
    ]);
    return r.rows;
  },

  async createComment(db, { external_user_id, id_user, content }) {
    const r = await db.query(
      `INSERT INTO public.casa_audience_comment
         (external_user_id, id_user, content)
       VALUES ($1, $2, $3)
       RETURNING id_casa_audience_comment, external_user_id, id_user, content,
                 created_at, updated_at, likes_count`,
      [external_user_id, id_user, content],
    );
    return r.rows[0] || null;
  },

  async getCommentById(db, id_casa_audience_comment) {
    const r = await db.query(
      `SELECT id_casa_audience_comment, external_user_id, id_user, content,
              is_active, created_at, updated_at, likes_count
         FROM public.casa_audience_comment
        WHERE id_casa_audience_comment = $1
          AND is_active = TRUE
        LIMIT 1`,
      [id_casa_audience_comment],
    );
    return r.rows[0] || null;
  },

  async getEnrichedCommentById(db, id_casa_audience_comment, viewer_id_user = null) {
    const r = await db.query(
      `SELECT
         c.id_casa_audience_comment,
         c.external_user_id,
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
             SELECT 1 FROM public.casa_audience_comment_like cl
              WHERE cl.id_casa_audience_comment = c.id_casa_audience_comment
                AND cl.id_user = $2::uuid
           )
         END AS viewer_has_liked
       FROM public.casa_audience_comment c
       JOIN public.tb_user u ON u.id_user = c.id_user
       LEFT JOIN public.tb_profile upa
         ON upa.id_user = c.id_user
        AND upa.is_user_account = TRUE
       WHERE c.id_casa_audience_comment = $1
         AND c.is_active = TRUE
       LIMIT 1`,
      [id_casa_audience_comment, viewer_id_user || null],
    );
    return r.rows[0] || null;
  },

  async deactivateComment(db, id_casa_audience_comment) {
    const r = await db.query(
      `UPDATE public.casa_audience_comment
          SET is_active = FALSE, updated_at = NOW()
        WHERE id_casa_audience_comment = $1
          AND is_active = TRUE
        RETURNING external_user_id`,
      [id_casa_audience_comment],
    );
    return r.rows[0] || null;
  },

  async recomputeTargetCounts(db, external_user_id) {
    const r = await db.query(
      `UPDATE public.casa_audience_target t
          SET likes_count = (
                SELECT COUNT(*)::INT
                  FROM public.casa_audience_like l
                 WHERE l.external_user_id = t.external_user_id
              ),
              comments_count = (
                SELECT COUNT(*)::INT
                  FROM public.casa_audience_comment c
                 WHERE c.external_user_id = t.external_user_id
                   AND c.is_active = TRUE
              ),
              updated_at = NOW()
        WHERE t.external_user_id = $1
        RETURNING likes_count, comments_count`,
      [external_user_id],
    );
    return r.rows[0] || { likes_count: 0, comments_count: 0 };
  },

  async toggleTargetLike(db, { external_user_id, id_user }) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const ins = await client.query(
        `INSERT INTO public.casa_audience_like (external_user_id, id_user)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [external_user_id, id_user],
      );

      let liked;
      if (ins.rowCount === 1) {
        liked = true;
      } else {
        const del = await client.query(
          `DELETE FROM public.casa_audience_like
            WHERE external_user_id = $1 AND id_user = $2`,
          [external_user_id, id_user],
        );
        liked = del.rowCount === 0;
      }

      const counts = await this.recomputeTargetCounts(client, external_user_id);
      await client.query("COMMIT");
      return { liked, likes_count: Number(counts.likes_count) || 0 };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async toggleCommentLike(db, { id_casa_audience_comment, id_user }) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const ins = await client.query(
        `INSERT INTO public.casa_audience_comment_like (id_casa_audience_comment, id_user)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id_casa_audience_comment, id_user],
      );

      let liked;
      if (ins.rowCount === 1) {
        liked = true;
      } else {
        const del = await client.query(
          `DELETE FROM public.casa_audience_comment_like
            WHERE id_casa_audience_comment = $1 AND id_user = $2`,
          [id_casa_audience_comment, id_user],
        );
        liked = del.rowCount === 0;
      }

      const upd = await client.query(
        `UPDATE public.casa_audience_comment c
            SET likes_count = (
              SELECT COUNT(*)::INT
                FROM public.casa_audience_comment_like cl
               WHERE cl.id_casa_audience_comment = c.id_casa_audience_comment
            ),
            updated_at = NOW()
          WHERE c.id_casa_audience_comment = $1
          RETURNING likes_count`,
        [id_casa_audience_comment],
      );

      await client.query("COMMIT");
      return {
        liked,
        likes_count: Number(upd.rows[0]?.likes_count) || 0,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = CasaAudienceInteractionStorage;
