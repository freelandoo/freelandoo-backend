const STORY_COLUMNS = `
  s.id_story,
  s.id_profile,
  s.id_user,
  s.kind,
  s.video_url,
  s.thumbnail_url,
  s.storage_key,
  s.thumbnail_key,
  s.duration_seconds,
  s.width,
  s.height,
  s.caption,
  s.metadata,
  s.created_at,
  s.expires_at,
  s.deleted_at
`;

class StoryStorage {
  static async getProfileForOwnership(conn, { id_profile, id_user }) {
    const { rows } = await conn.query(
      `
      SELECT p.id_profile, p.id_user, p.is_active, p.display_name, p.avatar_url,
             p.is_clan, p.id_category, c.id_machine, m.name AS machine_name,
             m.slug AS machine_slug
        FROM public.tb_profile p
        LEFT JOIN public.tb_category c ON c.id_category = p.id_category
        LEFT JOIN public.tb_machine m ON m.id_machine = c.id_machine
       WHERE p.id_profile = $1
         AND p.id_user = $2
       LIMIT 1
      `,
      [id_profile, id_user]
    );
    return rows[0] || null;
  }

  static async profileHasActiveSubscription(conn, id_profile) {
    const { rows } = await conn.query(
      `
      SELECT 1
        FROM public.tb_profile_subscription
       WHERE id_profile = $1
         AND status = 'active'
       LIMIT 1
      `,
      [id_profile]
    );
    return rows.length > 0;
  }

  static async insertStory(conn, data) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_story (
        id_profile, id_user, kind,
        video_url, thumbnail_url, storage_key, thumbnail_key,
        duration_seconds, width, height, caption, metadata,
        expires_at
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11, COALESCE($12, '{}'::jsonb),
        NOW() + INTERVAL '24 hours'
      )
      RETURNING ${STORY_COLUMNS.replace(/s\./g, "")}
      `,
      [
        data.id_profile,
        data.id_user,
        data.kind,
        data.video_url,
        data.thumbnail_url,
        data.storage_key,
        data.thumbnail_key,
        data.duration_seconds,
        data.width,
        data.height,
        data.caption,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    return rows[0] || null;
  }

  static async listActiveByUser(conn, { id_user, kind = null }) {
    const params = [id_user];
    let kindClause = "";
    if (kind === "trampo" || kind === "rest") {
      params.push(kind);
      kindClause = `AND s.kind = $${params.length}`;
    }

    const { rows } = await conn.query(
      `
      SELECT ${STORY_COLUMNS},
             p.display_name AS profile_display_name,
             p.avatar_url   AS profile_avatar_url,
             p.is_clan      AS profile_is_clan,
             m.name         AS machine_name,
             m.slug         AS machine_slug
        FROM public.tb_story s
        JOIN public.tb_profile p ON p.id_profile = s.id_profile
        LEFT JOIN public.tb_category c ON c.id_category = p.id_category
        LEFT JOIN public.tb_machine  m ON m.id_machine  = c.id_machine
       WHERE s.id_user = $1
         AND s.deleted_at IS NULL
         AND s.expires_at > NOW()
         ${kindClause}
       ORDER BY s.created_at ASC
      `,
      params
    );
    return rows;
  }

  static async getByIdForOwner(conn, { id_story, id_user }) {
    const { rows } = await conn.query(
      `
      SELECT ${STORY_COLUMNS}
        FROM public.tb_story s
       WHERE s.id_story = $1
         AND s.id_user  = $2
       LIMIT 1
      `,
      [id_story, id_user]
    );
    return rows[0] || null;
  }

  static async softDelete(conn, { id_story, id_user }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_story
         SET deleted_at = NOW()
       WHERE id_story = $1
         AND id_user  = $2
         AND deleted_at IS NULL
       RETURNING ${STORY_COLUMNS.replace(/s\./g, "")}
      `,
      [id_story, id_user]
    );
    return rows[0] || null;
  }
}

module.exports = StoryStorage;
