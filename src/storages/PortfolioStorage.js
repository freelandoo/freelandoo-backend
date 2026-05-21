class PortfolioStorage {
  // --------- Helpers ----------
  static async itemBelongsToProfile(conn, id_portfolio_item, id_profile) {
    const r = await conn.query(
      `
      SELECT 1
      FROM public.tb_profile_portfolio_item
      WHERE id_portfolio_item = $1
        AND id_profile = $2
      LIMIT 1
      `,
      [id_portfolio_item, id_profile]
    );
    return r.rowCount > 0;
  }

  static async getItemFeedKind(conn, id_portfolio_item) {
    const r = await conn.query(
      `SELECT feed_kind FROM public.tb_profile_portfolio_item WHERE id_portfolio_item = $1 LIMIT 1`,
      [id_portfolio_item]
    );
    return r.rows[0]?.feed_kind || null;
  }

  // --------- Create ----------
  static async createItem(
    conn,
    {
      id_profile,
      title,
      description,
      project_url,
      is_featured,
      sort_order,
      created_by,
      feed_kind,
    }
  ) {
    const kind = feed_kind === "bees" ? "bees" : "feed";
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile_portfolio_item
        (id_profile, title, description, project_url, is_featured, sort_order, created_by, updated_by, feed_kind)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $7, $8)
      RETURNING
        id_portfolio_item, id_profile, title, description, project_url,
        is_featured, sort_order, feed_kind, created_at, updated_at, is_active
      `,
      [
        id_profile,
        title,
        description,
        project_url,
        is_featured,
        sort_order,
        created_by,
        kind,
      ]
    );
    return r.rows[0];
  }

  static async addMedia(
    conn,
    {
      id_portfolio_item,
      media_url,
      media_type,
      thumbnail_url,
      sort_order,
      created_by,
      metadata = {},
    }
  ) {
    const mediaMetadata = metadata || {};
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile_portfolio_media
        (
          id_portfolio_item,
          media_url,
          media_type,
          thumbnail_url,
          sort_order,
          created_by,
          original_filename,
          mime_type,
          width,
          height,
          size_bytes,
          duration_seconds,
          storage_key,
          metadata
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING
        id_portfolio_media, id_portfolio_item, media_url, media_type,
        thumbnail_url, sort_order, created_at, is_active,
        original_filename, mime_type, width, height, size_bytes,
        duration_seconds, storage_key, metadata
      `,
      [
        id_portfolio_item,
        media_url,
        media_type,
        thumbnail_url,
        sort_order,
        created_by,
        mediaMetadata.original_filename || null,
        mediaMetadata.mime_type || null,
        mediaMetadata.width || null,
        mediaMetadata.height || null,
        mediaMetadata.size_bytes || null,
        mediaMetadata.duration_seconds || null,
        mediaMetadata.storage_key || null,
        mediaMetadata,
      ]
    );
    return r.rows[0];
  }

  // --------- Update ----------
  static async updateItem(conn, id_portfolio_item, payload) {
    const fields = [];
    const values = [id_portfolio_item];
    let idx = 2;

    const has = (k) => Object.prototype.hasOwnProperty.call(payload || {}, k);

    if (has("title")) {
      fields.push(`title = $${idx++}`);
      values.push(payload.title);
    }
    if (has("description")) {
      fields.push(`description = $${idx++}`);
      values.push(payload.description);
    }
    if (has("project_url")) {
      fields.push(`project_url = $${idx++}`);
      values.push(payload.project_url);
    }
    if (has("is_featured")) {
      fields.push(`is_featured = $${idx++}`);
      values.push(payload.is_featured);
    }
    if (has("sort_order")) {
      fields.push(`sort_order = $${idx++}`);
      values.push(payload.sort_order);
    }
    if (has("is_active")) {
      fields.push(`is_active = $${idx++}`);
      values.push(payload.is_active);
    }
    if (has("updated_by")) {
      fields.push(`updated_by = $${idx++}`);
      values.push(payload.updated_by);
    }

    // sempre atualiza updated_at quando houver update
    fields.push(`updated_at = now()`);

    const r = await conn.query(
      `
      UPDATE public.tb_profile_portfolio_item
      SET ${fields.join(", ")}
      WHERE id_portfolio_item = $1
      RETURNING
        id_portfolio_item, id_profile, title, description, project_url,
        is_featured, sort_order, created_at, updated_at, is_active
      `,
      values
    );

    return r.rowCount ? r.rows[0] : null;
  }

  // --------- Disable ----------
  static async disableItem(conn, id_portfolio_item, updated_by) {
    const r = await conn.query(
      `
      UPDATE public.tb_profile_portfolio_item
      SET is_active = false, updated_at = now(), updated_by = $2
      WHERE id_portfolio_item = $1
      `,
      [id_portfolio_item, updated_by]
    );
    return r.rowCount > 0;
  }

  static async disableMedia(conn, id_portfolio_media) {
    const r = await conn.query(
      `
      UPDATE public.tb_profile_portfolio_media
      SET is_active = false
      WHERE id_portfolio_media = $1
      `,
      [id_portfolio_media]
    );
    return r.rowCount > 0;
  }

  static async mediaBelongsToItem(conn, id_portfolio_media, id_portfolio_item) {
    const r = await conn.query(
      `
      SELECT 1
      FROM public.tb_profile_portfolio_media
      WHERE id_portfolio_media = $1
        AND id_portfolio_item = $2
      LIMIT 1
      `,
      [id_portfolio_media, id_portfolio_item]
    );
    return r.rowCount > 0;
  }

  // --------- Reads ----------
  // Item público com perfil dono (pra preview de compartilhamento)
  static async getPublicItemWithProfile(conn, id_portfolio_item) {
    const r = await conn.query(
      `
      SELECT
        i.id_portfolio_item,
        i.id_profile,
        i.title,
        i.description,
        i.project_url,
        i.feed_kind,
        i.created_at,
        pro.display_name  AS profile_display_name,
        tu.username       AS profile_username,
        ca.profession_slug,
        pro.municipio     AS profile_municipio,
        mf.manifestation,
        COALESCE(mq.media, '[]'::jsonb) AS media
      FROM public.tb_profile_portfolio_item i
      JOIN public.tb_profile pro ON pro.id_profile = i.id_profile
      JOIN public.tb_user tu ON tu.id_user = pro.id_user
      LEFT JOIN public.tb_category ca ON ca.id_category = pro.id_category
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
          'banner_url', mp.banner_url,
          'banner_thumb_url', mp.banner_thumb_url,
          'tag_label', mp.tag_label,
          'tag_color', mp.tag_color,
          'tag_icon', mp.tag_icon,
          'expires_at', um.expires_at
        ) AS manifestation
        FROM public.user_manifestations um
        JOIN public.manifestation_products mp ON mp.id = um.product_id
        WHERE um.user_id = pro.id_user
          AND um.is_active = TRUE
          AND (um.expires_at IS NULL OR um.expires_at > NOW())
          AND COALESCE(pro.is_clan, FALSE) = FALSE
        LIMIT 1
      ) mf ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_portfolio_media', m.id_portfolio_media,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'thumbnail_url', m.thumbnail_url,
            'sort_order', m.sort_order,
            'width', m.width,
            'height', m.height,
            'size_bytes', m.size_bytes,
            'mime_type', m.mime_type
          )
          ORDER BY m.sort_order, m.created_at
        ) AS media
        FROM public.tb_profile_portfolio_media m
        WHERE m.id_portfolio_item = i.id_portfolio_item
          AND m.is_active = true
      ) mq ON true
      WHERE i.id_portfolio_item = $1
        AND i.is_active = true
        AND i.is_banned = false
        AND pro.deleted_at IS NULL
      LIMIT 1
      `,
      [id_portfolio_item]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getItemWithMedia(conn, id_portfolio_item) {
    const r = await conn.query(
      `
      SELECT
        i.id_portfolio_item,
        i.id_profile,
        i.title,
        i.description,
        i.project_url,
        i.is_featured,
        i.sort_order,
        i.feed_kind,
        i.created_at,
        i.updated_at,
        i.is_active,

        COALESCE(mq.media, '[]'::jsonb) AS media
      FROM public.tb_profile_portfolio_item i
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_portfolio_media', m.id_portfolio_media,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'thumbnail_url', m.thumbnail_url,
            'sort_order', m.sort_order,
            'width', m.width,
            'height', m.height,
            'size_bytes', m.size_bytes,
            'mime_type', m.mime_type,
            'is_active', m.is_active,
            'created_at', m.created_at
          )
          ORDER BY m.sort_order, m.created_at
        ) AS media
        FROM public.tb_profile_portfolio_media m
        WHERE m.id_portfolio_item = i.id_portfolio_item
          AND m.is_active = true
      ) mq ON true
      WHERE i.id_portfolio_item = $1
      LIMIT 1
      `,
      [id_portfolio_item]
    );

    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Lista agregada de portfólio para clan (clan próprio + cada membro).
   * Cada item carrega autor (display_name/username/avatar) e flag indicando
   * se veio do clan ou de um membro. Usado pra renderizar badge "Clan/Membro"
   * no portfólio público do clan.
   */
  static async listAggregatedItemsForClanPublic(
    conn,
    id_clan_profile,
    member_profile_ids,
    id_user_viewer = null,
    feed_kind = null
  ) {
    const ids = [id_clan_profile, ...(member_profile_ids ?? [])];
    const kindFilter = feed_kind === "bees" || feed_kind === "feed" ? feed_kind : null;
    const r = await conn.query(
      `
      SELECT
        i.id_portfolio_item,
        i.id_profile,
        i.title,
        i.description,
        i.project_url,
        i.is_featured,
        i.sort_order,
        i.feed_kind,
        i.comments_count,
        i.created_at,
        i.updated_at,

        COALESCE(lq.likes_count, 0) AS likes_count,
        COALESCE(lme.liked, false) AS liked_by_me,

        COALESCE(mq.media, '[]'::jsonb) AS media,

        pro.display_name AS author_display_name,
        pro.avatar_url   AS author_avatar_url,
        tu.username      AS author_username,
        (i.id_profile = $1::uuid) AS is_clan_self
      FROM public.tb_profile_portfolio_item i
      JOIN public.tb_profile pro ON pro.id_profile = i.id_profile
      JOIN public.tb_user tu ON tu.id_user = pro.id_user
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_portfolio_media', m.id_portfolio_media,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'thumbnail_url', m.thumbnail_url,
            'sort_order', m.sort_order,
            'width', m.width,
            'height', m.height,
            'size_bytes', m.size_bytes,
            'mime_type', m.mime_type
          )
          ORDER BY m.sort_order, m.created_at
        ) AS media
        FROM public.tb_profile_portfolio_media m
        WHERE m.id_portfolio_item = i.id_portfolio_item
          AND m.is_active = true
      ) mq ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS likes_count
          FROM public.portfolio_likes pl
         WHERE pl.id_portfolio_item = i.id_portfolio_item
      ) lq ON true
      LEFT JOIN LATERAL (
        SELECT TRUE AS liked
          FROM public.portfolio_likes pl
         WHERE pl.id_portfolio_item = i.id_portfolio_item
           AND pl.id_user = $2::uuid
         LIMIT 1
      ) lme ON $2::uuid IS NOT NULL
      WHERE i.id_profile = ANY($3::uuid[])
        AND i.is_active = true
        AND i.is_banned = false
        AND ($4::text IS NULL OR i.feed_kind = $4::text)
        AND NOT EXISTS (
          SELECT 1
            FROM public.tb_clan_hidden_post h
           WHERE h.id_clan_profile = $1::uuid
             AND h.id_portfolio_item = i.id_portfolio_item
        )
      ORDER BY
        i.is_featured DESC,
        i.sort_order DESC,
        i.created_at DESC
      `,
      [id_clan_profile, id_user_viewer, ids, kindFilter]
    );
    return r.rows;
  }

  // --------- Clan hidden posts ----------
  static async hideClanPost(conn, { id_clan_profile, id_portfolio_item, hidden_by_user, reason = null }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_hidden_post
        (id_clan_profile, id_portfolio_item, hidden_by_user, reason)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id_clan_profile, id_portfolio_item) DO UPDATE
        SET hidden_at = NOW(),
            hidden_by_user = EXCLUDED.hidden_by_user,
            reason = EXCLUDED.reason
      RETURNING id_clan_profile, id_portfolio_item, hidden_at
      `,
      [id_clan_profile, id_portfolio_item, hidden_by_user, reason]
    );
    return r.rows[0] || null;
  }

  static async unhideClanPost(conn, { id_clan_profile, id_portfolio_item }) {
    const r = await conn.query(
      `
      DELETE FROM public.tb_clan_hidden_post
       WHERE id_clan_profile = $1
         AND id_portfolio_item = $2
       RETURNING id_clan_profile, id_portfolio_item
      `,
      [id_clan_profile, id_portfolio_item]
    );
    return r.rowCount > 0;
  }

  static async listHiddenItemsForClan(conn, id_clan_profile) {
    const r = await conn.query(
      `
      SELECT
        h.id_portfolio_item,
        h.hidden_at,
        h.reason,
        i.id_profile,
        i.title,
        pro.display_name AS author_display_name
      FROM public.tb_clan_hidden_post h
      JOIN public.tb_profile_portfolio_item i ON i.id_portfolio_item = h.id_portfolio_item
      JOIN public.tb_profile pro ON pro.id_profile = i.id_profile
      WHERE h.id_clan_profile = $1
      ORDER BY h.hidden_at DESC
      `,
      [id_clan_profile]
    );
    return r.rows;
  }

  static async isPostHiddenInClan(conn, { id_clan_profile, id_portfolio_item }) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_clan_hidden_post
        WHERE id_clan_profile = $1 AND id_portfolio_item = $2 LIMIT 1`,
      [id_clan_profile, id_portfolio_item]
    );
    return r.rowCount > 0;
  }

  static async listItemsWithMediaPublic(conn, id_profile, id_user_viewer = null, feed_kind = null) {
    const kindFilter = feed_kind === "bees" || feed_kind === "feed" ? feed_kind : null;
    const r = await conn.query(
      `
      SELECT
        i.id_portfolio_item,
        i.id_profile,
        i.title,
        i.description,
        i.project_url,
        i.is_featured,
        i.sort_order,
        i.feed_kind,
        i.comments_count,
        i.created_at,
        i.updated_at,

        COALESCE(lq.likes_count, 0) AS likes_count,
        COALESCE(lme.liked, false) AS liked_by_me,

        COALESCE(mq.media, '[]'::jsonb) AS media
      FROM public.tb_profile_portfolio_item i
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_portfolio_media', m.id_portfolio_media,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'thumbnail_url', m.thumbnail_url,
            'sort_order', m.sort_order,
            'width', m.width,
            'height', m.height,
            'size_bytes', m.size_bytes,
            'mime_type', m.mime_type
          )
          ORDER BY m.sort_order, m.created_at
        ) AS media
        FROM public.tb_profile_portfolio_media m
        WHERE m.id_portfolio_item = i.id_portfolio_item
          AND m.is_active = true
      ) mq ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS likes_count
          FROM public.portfolio_likes pl
         WHERE pl.id_portfolio_item = i.id_portfolio_item
      ) lq ON true
      LEFT JOIN LATERAL (
        SELECT TRUE AS liked
          FROM public.portfolio_likes pl
         WHERE pl.id_portfolio_item = i.id_portfolio_item
           AND pl.id_user = $2::uuid
         LIMIT 1
      ) lme ON $2::uuid IS NOT NULL
      WHERE i.id_profile = $1
        AND i.is_active = true
        AND i.is_banned = false
        AND ($3::text IS NULL OR i.feed_kind = $3::text)
      ORDER BY
        i.is_featured DESC,
        i.sort_order DESC,
        i.created_at DESC
      `,
      [id_profile, id_user_viewer, kindFilter]
    );

    return r.rows;
  }
}

module.exports = PortfolioStorage;
