// src/storages/RankingSocialStorage.js
// Likes e comentarios do /ranking sobre perfis/clans (mig 147). Espelha o
// modelo do CasaAudienceInteractionStorage, mas o alvo e tb_profile e os
// contadores do alvo sao computados on-the-fly (listas top-20, sem tabela de
// contagem denormalizada).
const COMMENT_SELECT = `
  SELECT
    c.id_ranking_comment,
    c.id_profile,
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
        SELECT 1 FROM public.ranking_comment_like cl
         WHERE cl.id_ranking_comment = c.id_ranking_comment
           AND cl.id_user = $4::uuid
      )
    END AS viewer_has_liked
  FROM public.ranking_comment c
  JOIN public.tb_user u ON u.id_user = c.id_user
  LEFT JOIN public.tb_profile upa
    ON upa.id_user = c.id_user
   AND upa.is_user_account = TRUE
  WHERE c.id_profile = $1
    AND c.is_active = TRUE
    AND ($2::timestamptz IS NULL OR c.created_at < $2::timestamptz)
  ORDER BY c.created_at DESC, c.id_ranking_comment DESC
  LIMIT $3
`;

const RankingSocialStorage = {
  async profileExists(db, id_profile) {
    const r = await db.query(
      `SELECT 1 FROM public.tb_profile
        WHERE id_profile = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [id_profile],
    );
    return r.rows.length > 0;
  },

  async getSummary(db, { id_profile, viewer_id_user = null }) {
    const r = await db.query(
      `SELECT
         $1::uuid AS id_profile,
         (SELECT COUNT(*)::INT FROM public.ranking_profile_like l
           WHERE l.id_profile = $1) AS likes_count,
         (SELECT COUNT(*)::INT FROM public.ranking_comment c
           WHERE c.id_profile = $1 AND c.is_active = TRUE) AS comments_count,
         CASE
           WHEN $2::uuid IS NULL THEN FALSE
           ELSE EXISTS (
             SELECT 1 FROM public.ranking_profile_like l
              WHERE l.id_profile = $1 AND l.id_user = $2::uuid
           )
         END AS viewer_has_liked`,
      [id_profile, viewer_id_user || null],
    );
    return r.rows[0] || null;
  },

  async listSummaries(db, { profile_ids, viewer_id_user = null }) {
    const r = await db.query(
      `SELECT
         x.id_profile,
         (SELECT COUNT(*)::INT FROM public.ranking_profile_like l
           WHERE l.id_profile = x.id_profile) AS likes_count,
         (SELECT COUNT(*)::INT FROM public.ranking_comment c
           WHERE c.id_profile = x.id_profile AND c.is_active = TRUE) AS comments_count,
         CASE
           WHEN $2::uuid IS NULL THEN FALSE
           ELSE EXISTS (
             SELECT 1 FROM public.ranking_profile_like l
              WHERE l.id_profile = x.id_profile AND l.id_user = $2::uuid
           )
         END AS viewer_has_liked
       FROM unnest($1::uuid[]) AS x(id_profile)`,
      [profile_ids, viewer_id_user || null],
    );
    return r.rows;
  },

  async toggleProfileLike(db, { id_profile, id_user }) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const ins = await client.query(
        `INSERT INTO public.ranking_profile_like (id_profile, id_user)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id_profile, id_user],
      );

      let liked;
      if (ins.rowCount === 1) {
        liked = true;
      } else {
        const del = await client.query(
          `DELETE FROM public.ranking_profile_like
            WHERE id_profile = $1 AND id_user = $2`,
          [id_profile, id_user],
        );
        liked = del.rowCount === 0;
      }

      const count = await client.query(
        `SELECT COUNT(*)::INT AS likes_count
           FROM public.ranking_profile_like
          WHERE id_profile = $1`,
        [id_profile],
      );

      await client.query("COMMIT");
      return { liked, likes_count: Number(count.rows[0]?.likes_count) || 0 };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async listComments(db, { id_profile, cursor = null, limit = 20, viewer_id_user = null }) {
    const r = await db.query(COMMENT_SELECT, [
      id_profile,
      cursor || null,
      Math.min(Math.max(limit, 1), 50),
      viewer_id_user || null,
    ]);
    return r.rows;
  },

  async createComment(db, { id_profile, id_user, content }) {
    const r = await db.query(
      `INSERT INTO public.ranking_comment (id_profile, id_user, content)
       VALUES ($1, $2, $3)
       RETURNING id_ranking_comment, id_profile, id_user, content,
                 created_at, updated_at, likes_count`,
      [id_profile, id_user, content],
    );
    return r.rows[0] || null;
  },

  async getCommentById(db, id_ranking_comment) {
    const r = await db.query(
      `SELECT id_ranking_comment, id_profile, id_user, content,
              is_active, created_at, updated_at, likes_count
         FROM public.ranking_comment
        WHERE id_ranking_comment = $1
          AND is_active = TRUE
        LIMIT 1`,
      [id_ranking_comment],
    );
    return r.rows[0] || null;
  },

  async getEnrichedCommentById(db, id_ranking_comment, viewer_id_user = null) {
    const r = await db.query(
      `SELECT
         c.id_ranking_comment,
         c.id_profile,
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
             SELECT 1 FROM public.ranking_comment_like cl
              WHERE cl.id_ranking_comment = c.id_ranking_comment
                AND cl.id_user = $2::uuid
           )
         END AS viewer_has_liked
       FROM public.ranking_comment c
       JOIN public.tb_user u ON u.id_user = c.id_user
       LEFT JOIN public.tb_profile upa
         ON upa.id_user = c.id_user
        AND upa.is_user_account = TRUE
       WHERE c.id_ranking_comment = $1
         AND c.is_active = TRUE
       LIMIT 1`,
      [id_ranking_comment, viewer_id_user || null],
    );
    return r.rows[0] || null;
  },

  async deactivateComment(db, id_ranking_comment) {
    const r = await db.query(
      `UPDATE public.ranking_comment
          SET is_active = FALSE, updated_at = NOW()
        WHERE id_ranking_comment = $1
          AND is_active = TRUE
        RETURNING id_profile`,
      [id_ranking_comment],
    );
    return r.rows[0] || null;
  },

  async toggleCommentLike(db, { id_ranking_comment, id_user }) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const ins = await client.query(
        `INSERT INTO public.ranking_comment_like (id_ranking_comment, id_user)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id_ranking_comment, id_user],
      );

      let liked;
      if (ins.rowCount === 1) {
        liked = true;
      } else {
        const del = await client.query(
          `DELETE FROM public.ranking_comment_like
            WHERE id_ranking_comment = $1 AND id_user = $2`,
          [id_ranking_comment, id_user],
        );
        liked = del.rowCount === 0;
      }

      const upd = await client.query(
        `UPDATE public.ranking_comment c
            SET likes_count = (
              SELECT COUNT(*)::INT
                FROM public.ranking_comment_like cl
               WHERE cl.id_ranking_comment = c.id_ranking_comment
            ),
            updated_at = NOW()
          WHERE c.id_ranking_comment = $1
          RETURNING likes_count`,
        [id_ranking_comment],
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

module.exports = RankingSocialStorage;
