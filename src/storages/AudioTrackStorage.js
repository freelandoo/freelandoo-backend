// SQL puro da biblioteca de áudio (tb_audio_track). Sem ORM.
class AudioTrackStorage {
  static async list(conn, { onlyActive = false, q = null, limit = null, offset = 0 } = {}) {
    const conds = [];
    const values = [];
    let i = 1;
    if (onlyActive) conds.push("is_active = TRUE");
    if (q) {
      conds.push(`(lower(title) LIKE $${i} OR lower(COALESCE(artist,'')) LIKE $${i})`);
      values.push(`%${String(q).toLowerCase()}%`);
      i++;
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `
      SELECT *
        FROM public.tb_audio_track
       ${where}
       ORDER BY sort_order ASC, created_at DESC`;
    if (limit != null) {
      sql += ` LIMIT $${i++}`;
      values.push(limit);
      sql += ` OFFSET $${i++}`;
      values.push(offset);
    }
    const { rows } = await conn.query(sql, values);
    return rows;
  }

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_audio_track WHERE id_audio_track = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async create(conn, { title, artist = null, storage_key, cover_key = null, duration_ms = 0, sort_order = 0, is_active = true }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_audio_track
         (title, artist, storage_key, cover_key, duration_ms, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, artist, storage_key, cover_key, duration_ms, sort_order, is_active]
    );
    return rows[0];
  }

  static async update(conn, id, patch) {
    const allowed = ["title", "artist", "cover_key", "duration_ms", "sort_order", "is_active"];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.tb_audio_track SET ${fields.join(", ")}
       WHERE id_audio_track = $${i}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async remove(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_audio_track WHERE id_audio_track = $1`,
      [id]
    );
    return rowCount > 0;
  }
}

module.exports = AudioTrackStorage;
