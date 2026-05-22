class UserFollowStorage {
  static async upsertActive(conn, { follower_user_id, target_profile_id }) {
    const { rows } = await conn.query(
      `
      WITH reactivated AS (
        UPDATE public.tb_user_follow
           SET deleted_at = NULL,
               updated_at = NOW()
         WHERE follower_user_id  = $1
           AND target_profile_id = $2
           AND deleted_at IS NOT NULL
         RETURNING *
      ),
      inserted AS (
        INSERT INTO public.tb_user_follow (follower_user_id, target_profile_id)
        SELECT $1, $2
        WHERE NOT EXISTS (
          SELECT 1 FROM public.tb_user_follow
           WHERE follower_user_id  = $1
             AND target_profile_id = $2
             AND deleted_at IS NULL
        )
        AND NOT EXISTS (SELECT 1 FROM reactivated)
        RETURNING *
      )
      SELECT * FROM reactivated
      UNION ALL
      SELECT * FROM inserted
      LIMIT 1
      `,
      [follower_user_id, target_profile_id]
    );
    return rows[0] || null;
  }

  static async softDelete(conn, { follower_user_id, target_profile_id }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_user_follow
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE follower_user_id  = $1
         AND target_profile_id = $2
         AND deleted_at IS NULL
       RETURNING *
      `,
      [follower_user_id, target_profile_id]
    );
    return rows[0] || null;
  }

  static async findActive(conn, { follower_user_id, target_profile_id }) {
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.tb_user_follow
       WHERE follower_user_id  = $1
         AND target_profile_id = $2
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [follower_user_id, target_profile_id]
    );
    return rows[0] || null;
  }

  static async listFollowedProfileIds(conn, follower_user_id) {
    const { rows } = await conn.query(
      `
      SELECT target_profile_id
        FROM public.tb_user_follow
       WHERE follower_user_id = $1
         AND deleted_at IS NULL
      `,
      [follower_user_id]
    );
    return rows.map((r) => r.target_profile_id);
  }

  static async listFollowedProfiles(conn, follower_user_id) {
    const { rows } = await conn.query(
      `
      SELECT
        p.id_profile,
        p.display_name,
        p.avatar_url,
        p.is_clan,
        p.sub_profile_slug,
        u.username,
        uf.created_at AS followed_at
        FROM public.tb_user_follow uf
        JOIN public.tb_profile p ON p.id_profile = uf.target_profile_id
        JOIN public.tb_user    u ON u.id_user    = p.id_user
       WHERE uf.follower_user_id = $1
         AND uf.deleted_at IS NULL
         AND p.deleted_at IS NULL
       ORDER BY uf.created_at DESC
      `,
      [follower_user_id]
    );
    return rows;
  }

  static async countActiveByUser(conn, follower_user_id) {
    const { rows } = await conn.query(
      `
      SELECT COUNT(*)::int AS following_count
        FROM public.tb_user_follow
       WHERE follower_user_id = $1
         AND deleted_at IS NULL
      `,
      [follower_user_id]
    );
    return Number(rows[0]?.following_count || 0);
  }
}

module.exports = UserFollowStorage;
