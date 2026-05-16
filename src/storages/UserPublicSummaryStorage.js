class UserPublicSummaryStorage {
  static async findUserIdByUsername(conn, username) {
    const r = await conn.query(
      `SELECT id_user FROM public.tb_user WHERE lower(username) = lower($1) LIMIT 1`,
      [username]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  static async countPublicProfiles(conn, id_user) {
    const r = await conn.query(
      `
      SELECT COUNT(*)::int AS total
        FROM public.tb_profile p
        JOIN public.tb_user u ON u.id_user = p.id_user
       WHERE p.id_user = $1
         AND u.is_minor = FALSE
         AND p.deleted_at IS NULL
         AND p.is_active = TRUE
         AND p.is_visible = TRUE
         AND p.showcase_visible = TRUE
         AND p.is_clan = FALSE
         AND p.is_user_account = FALSE
         AND EXISTS (
           SELECT 1 FROM public.tb_profile_subscription ps
            WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
         )
      `,
      [id_user]
    );
    return r.rows[0].total;
  }

  static async countPublicClans(conn, id_user) {
    const r = await conn.query(
      `
      SELECT COUNT(*)::int AS total
        FROM public.tb_profile clan
       WHERE clan.is_clan = TRUE
         AND clan.deleted_at IS NULL
         AND clan.is_visible = TRUE
         AND EXISTS (
           SELECT 1
             FROM public.tb_clan_member cm
             JOIN public.tb_profile member ON member.id_profile = cm.id_member_profile
            WHERE cm.id_clan_profile = clan.id_profile
              AND cm.role = 'owner'
              AND member.id_user = $1
         )
      `,
      [id_user]
    );
    return r.rows[0].total;
  }

  static async listPublishedCourses(conn, id_user, limit = 12) {
    const r = await conn.query(
      `
      SELECT
        id,
        title,
        slug,
        short_description,
        cover_url,
        price_cents,
        published_at
      FROM public.courses
      WHERE owner_user_id = $1
        AND status = 'published'
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT $2
      `,
      [id_user, limit]
    );
    return r.rows;
  }
}

module.exports = UserPublicSummaryStorage;
