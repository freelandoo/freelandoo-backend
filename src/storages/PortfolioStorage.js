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
    }
  ) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile_portfolio_item
        (id_profile, title, description, project_url, is_featured, sort_order, created_by, updated_by)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING
        id_portfolio_item, id_profile, title, description, project_url,
        is_featured, sort_order, created_at, updated_at, is_active
      `,
      [
        id_profile,
        title,
        description,
        project_url,
        is_featured,
        sort_order,
        created_by,
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
    }
  ) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile_portfolio_media
        (id_portfolio_item, media_url, media_type, thumbnail_url, sort_order, created_by)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING
        id_portfolio_media, id_portfolio_item, media_url, media_type,
        thumbnail_url, sort_order, created_at, is_active
      `,
      [
        id_portfolio_item,
        media_url,
        media_type,
        thumbnail_url,
        sort_order,
        created_by,
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

  static async listItemsWithMediaPublic(conn, id_profile) {
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
        i.created_at,
        i.updated_at,

        COALESCE(mq.media, '[]'::jsonb) AS media
      FROM public.tb_profile_portfolio_item i
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_portfolio_media', m.id_portfolio_media,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'thumbnail_url', m.thumbnail_url,
            'sort_order', m.sort_order
          )
          ORDER BY m.sort_order, m.created_at
        ) AS media
        FROM public.tb_profile_portfolio_media m
        WHERE m.id_portfolio_item = i.id_portfolio_item
          AND m.is_active = true
      ) mq ON true
      WHERE i.id_profile = $1
        AND i.is_active = true
      ORDER BY
        i.is_featured DESC,
        i.sort_order DESC,
        i.created_at DESC
      `,
      [id_profile]
    );

    return r.rows;
  }
}

module.exports = PortfolioStorage;
