class CourseFeedPostsStorage {
  static async getByCourseId(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT
         cfp.id,
         cfp.course_id,
         cfp.portfolio_item_id,
         cfp.message,
         cfp.created_at,
         cfp.updated_at,
         ppi.title,
         ppi.description,
         ppi.project_url,
         ppi.status,
         ppi.is_active,
         ppi.published_at,
         ppi.likes_count,
         ppi.shares_count,
         ppi.impressions_count
       FROM public.course_feed_publications cfp
       JOIN public.tb_profile_portfolio_item ppi
         ON ppi.id_portfolio_item = cfp.portfolio_item_id
       WHERE cfp.course_id = $1
       LIMIT 1`,
      [courseId],
    );
    return rows[0] || null;
  }

  static async createPortfolioItem(
    conn,
    {
      profileId,
      title,
      description,
      projectUrl,
      createdBy,
    },
  ) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_profile_portfolio_item (
         id_profile,
         title,
         description,
         project_url,
         is_featured,
         sort_order,
         is_active,
         status,
         published_at,
         created_by,
         updated_by
       ) VALUES ($1, $2, $3, $4, false, 0, true, 'published', NOW(), $5, $5)
       RETURNING *`,
      [profileId, title, description, projectUrl, createdBy],
    );
    return rows[0];
  }

  static async updatePortfolioItem(
    conn,
    portfolioItemId,
    {
      profileId,
      title,
      description,
      projectUrl,
      updatedBy,
      publish = true,
    },
  ) {
    const { rows } = await conn.query(
      `UPDATE public.tb_profile_portfolio_item
          SET id_profile = $2,
              title = $3,
              description = $4,
              project_url = $5,
              is_active = true,
              status = CASE WHEN $7::boolean THEN 'published' ELSE status END,
              published_at = CASE
                WHEN $7::boolean THEN COALESCE(published_at, NOW())
                ELSE published_at
              END,
              updated_at = NOW(),
              updated_by = $6
        WHERE id_portfolio_item = $1
        RETURNING *`,
      [portfolioItemId, profileId, title, description, projectUrl, updatedBy, publish],
    );
    return rows[0] || null;
  }

  static async upsertPublication(conn, { courseId, portfolioItemId, message }) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_feed_publications (
         course_id,
         portfolio_item_id,
         message
       ) VALUES ($1, $2, $3)
       ON CONFLICT (course_id) DO UPDATE
          SET portfolio_item_id = EXCLUDED.portfolio_item_id,
              message = EXCLUDED.message,
              updated_at = NOW()
       RETURNING *`,
      [courseId, portfolioItemId, message],
    );
    return rows[0];
  }

  static async archivePortfolioItem(conn, portfolioItemId, updatedBy) {
    const { rows } = await conn.query(
      `UPDATE public.tb_profile_portfolio_item
          SET status = 'archived',
              is_active = false,
              updated_at = NOW(),
              updated_by = $2
        WHERE id_portfolio_item = $1
        RETURNING *`,
      [portfolioItemId, updatedBy],
    );
    return rows[0] || null;
  }

  static async syncCoverMedia(
    conn,
    {
      portfolioItemId,
      coverUrl,
      createdBy,
    },
  ) {
    await conn.query(
      `UPDATE public.tb_profile_portfolio_media
          SET is_active = false
        WHERE id_portfolio_item = $1
          AND metadata->>'source' = 'course_feed_cover'`,
      [portfolioItemId],
    );

    if (!coverUrl) return null;

    const { rows } = await conn.query(
      `INSERT INTO public.tb_profile_portfolio_media (
         id_portfolio_item,
         media_url,
         media_type,
         thumbnail_url,
         sort_order,
         is_active,
         created_by,
         metadata
       ) VALUES (
         $1,
         $2,
         'image',
         $2,
         0,
         true,
         $3,
         '{"source":"course_feed_cover"}'::jsonb
       )
       RETURNING *`,
      [portfolioItemId, coverUrl, createdBy],
    );
    return rows[0] || null;
  }
}

module.exports = CourseFeedPostsStorage;
