class SocialMediaStorage {
  static async socialMediaTypeExistsActive(conn, id_social_media_type) {
    const r = await conn.query(
      `
      SELECT 1
      FROM public.tb_social_media_type
      WHERE id_social_media_type = $1
        AND is_active = true
      LIMIT 1
      `,
      [id_social_media_type]
    );
    return r.rowCount > 0;
  }

  static async followerRangeExistsActive(conn, id_follower_range) {
    const r = await conn.query(
      `
      SELECT 1
      FROM public.tb_follower_range
      WHERE id_follower_range = $1
        AND is_active = true
      LIMIT 1
      `,
      [id_follower_range]
    );
    return r.rowCount > 0;
  }

  /**
   * Upsert respeitando unique (id_profile, id_social_media_type)
   *
   * Regras:
   * - url: se vier undefined -> não altera; se vier string -> atualiza
   * - id_follower_range: se vier undefined -> não altera; se vier null -> limpa; se vier number -> atualiza
   */
  static async upsertProfileSocialMedia(
    conn,
    { id_profile, id_social_media_type, url, id_follower_range, phone_number_normalized }
  ) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile_social_media
        (id_profile, id_social_media_type, url, id_follower_range, phone_number_normalized, is_active)
      VALUES
        ($1, $2, $3, $4, $5, true)
      ON CONFLICT (id_profile, id_social_media_type)
      DO UPDATE SET
        url = COALESCE(EXCLUDED.url, public.tb_profile_social_media.url),
        id_follower_range = CASE
          WHEN EXCLUDED.id_follower_range IS NULL THEN public.tb_profile_social_media.id_follower_range
          ELSE EXCLUDED.id_follower_range
        END,
        phone_number_normalized = COALESCE(EXCLUDED.phone_number_normalized, public.tb_profile_social_media.phone_number_normalized),
        is_active = true
      RETURNING
        id_profile_social_media, id_profile, id_social_media_type, url, id_follower_range, phone_number_normalized, is_active
      `,
      [
        id_profile,
        id_social_media_type,
        url ?? null, // se undefined, vai null, e COALESCE preserva url
        id_follower_range === undefined ? null : id_follower_range,
        phone_number_normalized ?? null,
      ]
    );
    return r.rows[0];
  }

  static async updateProfileSocialMediaByType(
    conn,
    { id_profile, id_social_media_type, payload }
  ) {
    const fields = [];
    const values = [id_profile, id_social_media_type];
    let idx = 3;

    const has = (k) => Object.prototype.hasOwnProperty.call(payload || {}, k);

    if (has("url")) {
      fields.push(`url = $${idx++}`);
      values.push(payload.url);
    }
    if (has("id_follower_range")) {
      fields.push(`id_follower_range = $${idx++}`);
      values.push(payload.id_follower_range);
    }
    if (has("is_active")) {
      fields.push(`is_active = $${idx++}`);
      values.push(payload.is_active);
    }
    if (has("phone_number_normalized")) {
      fields.push(`phone_number_normalized = $${idx++}`);
      values.push(payload.phone_number_normalized);
    }

    if (fields.length === 0) return null;

    const r = await conn.query(
      `
      UPDATE public.tb_profile_social_media
      SET ${fields.join(", ")}
      WHERE id_profile = $1
        AND id_social_media_type = $2
      RETURNING
        id_profile_social_media, id_profile, id_social_media_type, url, id_follower_range, phone_number_normalized, is_active
      `,
      values
    );

    return r.rowCount ? r.rows[0] : null;
  }

  static async disableProfileSocialMediaByType(
    conn,
    id_profile,
    id_social_media_type
  ) {
    const r = await conn.query(
      `
      UPDATE public.tb_profile_social_media
      SET is_active = false
      WHERE id_profile = $1
        AND id_social_media_type = $2
      `,
      [id_profile, id_social_media_type]
    );
    return r.rowCount > 0;
  }
}

module.exports = SocialMediaStorage;
