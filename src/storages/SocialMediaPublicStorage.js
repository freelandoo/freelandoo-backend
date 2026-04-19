class SocialMediaPublicStorage {
  static async listTypes(conn) {
    const r = await conn.query(
      `
      SELECT
        id_social_media_type,
        desc_social_media_type,
        url,
        icon
      FROM public.tb_social_media_type
      WHERE is_active = true
      ORDER BY lower(desc_social_media_type)
      `
    );
    return r.rows;
  }

  static async listFollowerRanges(conn) {
    const r = await conn.query(
      `
      SELECT
        id_follower_range,
        follower_range
      FROM public.tb_follower_range
      WHERE is_active = true
      ORDER BY id_follower_range
      `
    );
    return r.rows;
  }
}

module.exports = SocialMediaPublicStorage;
