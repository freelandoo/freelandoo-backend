// Predicado de vida do bee (mig 183): 24h + 1h por ponto de engagement_score,
// teto 7 dias. Substitui o antigo "deleted_at IS NULL AND expires_at > NOW()"
// (linhas legadas trampo/rest têm score 0 → mesma janela de 24h).
const { BEE_ALIVE_SQL } = require("./BeeEngagementStorage");

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
  s.location,
  s.links,
  s.likes_count,
  s.comments_count,
  s.metadata,
  s.audio_track_id,
  s.audio_start_ms,
  s.created_at,
  s.expires_at,
  s.deleted_at
`;

// Faixa de áudio anexada (mig 108) — colunas extras quando há JOIN com tb_audio_track.
// Música é metadado: o player toca; nada é queimado.
const AUDIO_COLUMNS = `
  at.title       AS audio_title,
  at.artist      AS audio_artist,
  at.storage_key AS audio_storage_key,
  at.cover_key   AS audio_cover_key,
  at.duration_ms AS audio_duration_ms
`;
const AUDIO_JOIN = `
  LEFT JOIN public.tb_audio_track at
    ON at.id_audio_track = s.audio_track_id
   AND at.is_active = TRUE
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
        audio_track_id, audio_start_ms, render_meta,
        location, links,
        expires_at
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11, COALESCE($12, '{}'::jsonb),
        $13, COALESCE($14, 0), $15,
        $16, COALESCE($17, '[]'::jsonb),
        NOW() + INTERVAL '7 days'
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
        data.audio_track_id || null,
        data.audio_start_ms != null ? data.audio_start_ms : null,
        data.render_meta ? JSON.stringify(data.render_meta) : null,
        data.location || null,
        data.links && data.links.length ? JSON.stringify(data.links) : null,
      ]
    );
    return rows[0] || null;
  }

  static async listActiveByUser(conn, { id_user }) {
    const { rows } = await conn.query(
      `
      SELECT ${STORY_COLUMNS},
             ${AUDIO_COLUMNS},
             p.display_name AS profile_display_name,
             p.avatar_url   AS profile_avatar_url,
             p.is_clan      AS profile_is_clan,
             m.name         AS machine_name,
             m.slug         AS machine_slug
        FROM public.tb_story s
        JOIN public.tb_profile p ON p.id_profile = s.id_profile
        LEFT JOIN public.tb_category c ON c.id_category = p.id_category
        LEFT JOIN public.tb_machine  m ON m.id_machine  = c.id_machine
        ${AUDIO_JOIN}
       WHERE s.id_user = $1
         AND ${BEE_ALIVE_SQL}
       ORDER BY s.created_at ASC
      `,
      [id_user]
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

  /**
   * Lista da faixa horizontal: 1 linha por perfil que o user está acompanhando
   * que tem >=1 story ativa do canal informado. Inclui flag has_unviewed
   * (TRUE se existe alguma story do perfil que o viewer ainda não assistiu).
   */
  static async listFeedForUser(conn, { viewer_user_id }) {
    const { rows } = await conn.query(
      `
      WITH visible_profiles AS (
        -- Perfis que o viewer segue
        SELECT target_profile_id AS id_profile, FALSE AS is_self
          FROM public.tb_user_follow
         WHERE follower_user_id = $1
           AND deleted_at IS NULL
        UNION
        -- Os próprios subperfis do viewer (igual Instagram: sua story aparece primeiro)
        SELECT id_profile, TRUE AS is_self
          FROM public.tb_profile
         WHERE id_user = $1
           AND deleted_at IS NULL
      ),
      active_stories AS (
        SELECT
          s.id_profile,
          BOOL_OR(vp.is_self) AS is_self,
          BOOL_OR(NOT EXISTS (
            SELECT 1 FROM public.tb_story_view v
             WHERE v.id_story = s.id_story
               AND v.id_viewer_user = $1
          )) AS has_unviewed,
          MAX(s.created_at) AS last_posted_at,
          COUNT(*)::int    AS active_count
        FROM public.tb_story s
        JOIN visible_profiles vp ON vp.id_profile = s.id_profile
        WHERE ${BEE_ALIVE_SQL}
          -- 'rest' legado segue aparecendo por até 24h pós-deploy do Bees v2.
          AND s.kind IN ('bee', 'rest')
        GROUP BY s.id_profile
      )
      SELECT
        a.id_profile,
        a.is_self,
        a.has_unviewed,
        a.last_posted_at,
        a.active_count,
        p.id_user            AS profile_user_id,
        p.display_name       AS profile_display_name,
        p.avatar_url         AS profile_avatar_url,
        p.is_clan            AS profile_is_clan,
        u.username           AS profile_username,
        p.sub_profile_slug   AS profile_slug,
        m.name               AS machine_name,
        m.slug               AS machine_slug,
        m.color_from         AS machine_color_from,
        m.color_to           AS machine_color_to,
        m.color_ring         AS machine_color_ring,
        m.color_accent       AS machine_color_accent
      FROM active_stories a
      JOIN public.tb_profile p ON p.id_profile = a.id_profile
      JOIN public.tb_user    u ON u.id_user    = p.id_user
      LEFT JOIN public.tb_category c
        ON c.id_category = p.id_category
      LEFT JOIN public.tb_machine  m
        ON m.id_machine = COALESCE(c.id_machine, p.id_machine)
      WHERE p.deleted_at IS NULL
        AND p.is_active  = TRUE
      ORDER BY a.is_self DESC, a.has_unviewed DESC, a.last_posted_at DESC
      `,
      [viewer_user_id]
    );
    return rows;
  }

  static async listActiveByProfile(conn, { id_profile }) {
    const { rows } = await conn.query(
      `
      SELECT ${STORY_COLUMNS},
             ${AUDIO_COLUMNS},
             p.display_name AS profile_display_name,
             p.avatar_url   AS profile_avatar_url,
             p.is_clan      AS profile_is_clan,
             m.name         AS machine_name,
             m.slug         AS machine_slug
        FROM public.tb_story s
        JOIN public.tb_profile p ON p.id_profile = s.id_profile
        LEFT JOIN public.tb_category c ON c.id_category = p.id_category
        LEFT JOIN public.tb_machine  m ON m.id_machine  = COALESCE(c.id_machine, p.id_machine)
        ${AUDIO_JOIN}
       WHERE s.id_profile = $1
         AND ${BEE_ALIVE_SQL}
       ORDER BY s.created_at ASC
      `,
      [id_profile]
    );
    return rows;
  }

  static async getActiveById(conn, id_story) {
    const { rows } = await conn.query(
      `
      SELECT ${STORY_COLUMNS},
             ${AUDIO_COLUMNS}
        FROM public.tb_story s
        ${AUDIO_JOIN}
       WHERE s.id_story = $1
         AND ${BEE_ALIVE_SQL}
       LIMIT 1
      `,
      [id_story]
    );
    return rows[0] || null;
  }

  static async listViewedIds(conn, { id_viewer_user, story_ids }) {
    if (!story_ids || story_ids.length === 0) return [];
    const { rows } = await conn.query(
      `
      SELECT id_story
        FROM public.tb_story_view
       WHERE id_viewer_user = $1
         AND id_story = ANY($2::uuid[])
      `,
      [id_viewer_user, story_ids]
    );
    return rows.map((r) => r.id_story);
  }

  // Bees v2: quais desses bees o viewer já curtiu (espelho do listViewedIds,
  // alimenta o estado inicial do like no StoryPlayer).
  static async listLikedIds(conn, { id_user, story_ids }) {
    if (!story_ids || story_ids.length === 0) return [];
    const { rows } = await conn.query(
      `
      SELECT id_story
        FROM public.tb_story_like
       WHERE id_user = $1
         AND id_story = ANY($2::uuid[])
      `,
      [id_user, story_ids]
    );
    return rows.map((r) => r.id_story);
  }

  static async markViewed(conn, { id_story, id_viewer_user }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_story_view (id_story, id_viewer_user)
      VALUES ($1, $2)
      ON CONFLICT (id_story, id_viewer_user) DO NOTHING
      RETURNING id_story, id_viewer_user, viewed_at
      `,
      [id_story, id_viewer_user]
    );
    const inserted = rows[0] || null;
    // 1ª view do par (story, viewer) vira impressão. Impressão NÃO pontua no
    // engagement_score (paridade com posts) — alimenta o penalty/underexposed
    // do mix e o contador de alcance.
    if (inserted) {
      await conn.query(
        `UPDATE public.tb_story
            SET impressions_count = impressions_count + 1
          WHERE id_story = $1`,
        [id_story]
      );
    }
    return inserted;
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
