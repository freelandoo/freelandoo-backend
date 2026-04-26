class ProfileServiceStorage {
  static async list(conn, id_profile, { only_active = false } = {}) {
    const where = ["id_profile = $1", "deleted_at IS NULL"];
    if (only_active) where.push("is_active = TRUE");
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_service
       WHERE ${where.join(" AND ")}
       ORDER BY created_at ASC`,
      [id_profile]
    );
    return r.rows;
  }

  static async getById(conn, id_profile_service) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_service
       WHERE id_profile_service = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [id_profile_service]
    );
    return r.rows[0] || null;
  }

  static async create(conn, { id_profile, name, description, duration_minutes, price_amount, is_active }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_service
        (id_profile, name, description, duration_minutes, price_amount, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id_profile, name, description || null, duration_minutes, price_amount, is_active !== false]
    );
    return r.rows[0];
  }

  static async update(conn, id_profile_service, fields) {
    const allowed = ["name", "description", "duration_minutes", "price_amount", "is_active"];
    const sets = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = $${i++}`);
        values.push(fields[k]);
      }
    }
    if (sets.length === 0) return null;
    sets.push(`updated_at = NOW()`);
    values.push(id_profile_service);
    const r = await conn.query(
      `UPDATE public.tb_profile_service
       SET ${sets.join(", ")}
       WHERE id_profile_service = $${i} AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    return r.rows[0] || null;
  }

  static async softDelete(conn, id_profile_service) {
    const r = await conn.query(
      `UPDATE public.tb_profile_service
       SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
       WHERE id_profile_service = $1 AND deleted_at IS NULL
       RETURNING id_profile_service`,
      [id_profile_service]
    );
    return r.rowCount > 0;
  }
}

module.exports = ProfileServiceStorage;
