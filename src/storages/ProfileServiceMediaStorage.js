class ProfileServiceMediaStorage {
  static async listByService(conn, id_profile_service) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_service_media
       WHERE id_profile_service = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [id_profile_service]
    );
    return r.rows;
  }

  static async listByServices(conn, id_profile_services) {
    if (!id_profile_services || id_profile_services.length === 0) return new Map();
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_service_media
       WHERE id_profile_service = ANY($1::bigint[])
       ORDER BY sort_order ASC, created_at ASC`,
      [id_profile_services]
    );
    const map = new Map();
    for (const row of r.rows) {
      const key = String(row.id_profile_service);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }

  static async create(conn, {
    id_profile_service, id_profile, media_url, media_type,
    thumbnail_url, storage_key, thumbnail_key,
    original_filename, mime_type, width, height, size_bytes, duration_seconds,
    sort_order,
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_service_media
        (id_profile_service, id_profile, media_url, media_type,
         thumbnail_url, storage_key, thumbnail_key,
         original_filename, mime_type, width, height, size_bytes, duration_seconds,
         sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        id_profile_service, id_profile, media_url, media_type,
        thumbnail_url || null, storage_key || null, thumbnail_key || null,
        original_filename || null, mime_type || null,
        width || null, height || null, size_bytes || null, duration_seconds || null,
        sort_order || 0,
      ]
    );
    return r.rows[0];
  }

  static async findById(conn, id_service_media) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_service_media WHERE id_service_media = $1 LIMIT 1`,
      [id_service_media]
    );
    return r.rows[0] || null;
  }

  static async remove(conn, id_service_media) {
    const r = await conn.query(
      `DELETE FROM public.tb_profile_service_media WHERE id_service_media = $1 RETURNING *`,
      [id_service_media]
    );
    return r.rows[0] || null;
  }

  static async reorder(conn, id_profile_service, orderedIds) {
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.query(
        `UPDATE public.tb_profile_service_media
         SET sort_order = $1
         WHERE id_service_media = $2 AND id_profile_service = $3`,
        [i, orderedIds[i], id_profile_service]
      );
    }
  }
}

module.exports = ProfileServiceMediaStorage;
