class UserPublicSummaryStorage {
  static async findUserIdByUsername(conn, username) {
    const r = await conn.query(
      `SELECT id_user FROM public.tb_user WHERE lower(username) = lower($1) LIMIT 1`,
      [username]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  // Perfil-conta (is_user_account) do usuário — base da paridade user≡subperfil:
  // é ele quem carrega XP/nível, seguidores e redes sociais do "user".
  static async getAccountProfile(conn, id_user) {
    const r = await conn.query(
      `SELECT p.id_profile, p.display_name, p.avatar_url,
              p.xp_total, p.xp_level
         FROM public.tb_profile p
        WHERE p.id_user = $1
          AND p.is_user_account = TRUE
          AND p.deleted_at IS NULL
          AND p.is_active = TRUE
        LIMIT 1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async listSocialMedia(conn, id_profile) {
    const r = await conn.query(
      `SELECT psm.id_profile_social_media,
              psm.id_social_media_type,
              smt.desc_social_media_type,
              smt.icon,
              psm.url,
              fr.follower_range
         FROM public.tb_profile_social_media psm
         JOIN public.tb_social_media_type smt
           ON smt.id_social_media_type = psm.id_social_media_type
         LEFT JOIN public.tb_follower_range fr
           ON fr.id_follower_range = psm.id_follower_range
        WHERE psm.id_profile = $1
          AND psm.is_active = TRUE
        ORDER BY smt.desc_social_media_type`,
      [id_profile]
    );
    return r.rows;
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
