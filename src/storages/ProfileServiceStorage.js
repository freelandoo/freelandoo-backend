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

  static async getMemberIds(conn, id_profile_service) {
    const r = await conn.query(
      `SELECT id_member_profile
       FROM public.tb_profile_service_member
       WHERE id_profile_service = $1
       ORDER BY created_at ASC`,
      [id_profile_service]
    );
    return r.rows.map((row) => row.id_member_profile);
  }

  static async getMemberIdsByServices(conn, id_profile_services) {
    if (!id_profile_services || id_profile_services.length === 0) return new Map();
    const r = await conn.query(
      `SELECT id_profile_service, id_member_profile
       FROM public.tb_profile_service_member
       WHERE id_profile_service = ANY($1::bigint[])
       ORDER BY created_at ASC`,
      [id_profile_services]
    );
    const map = new Map();
    for (const row of r.rows) {
      const key = String(row.id_profile_service);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row.id_member_profile);
    }
    return map;
  }

  static async setMembers(conn, id_profile_service, member_profile_ids) {
    await conn.query(
      `DELETE FROM public.tb_profile_service_member WHERE id_profile_service = $1`,
      [id_profile_service]
    );
    if (!member_profile_ids || member_profile_ids.length === 0) return;
    const values = [];
    const params = [];
    let i = 1;
    for (const mid of member_profile_ids) {
      values.push(`($${i++}, $${i++})`);
      params.push(id_profile_service, mid);
    }
    await conn.query(
      `INSERT INTO public.tb_profile_service_member (id_profile_service, id_member_profile)
       VALUES ${values.join(", ")}
       ON CONFLICT DO NOTHING`,
      params
    );
  }
}

module.exports = ProfileServiceStorage;
