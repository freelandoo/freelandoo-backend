class CouponStorage {
  static async create(conn, data) {
    const result = await conn.query(
      `
      INSERT INTO public.tb_coupon (
        code,
        discount_type,
        scope,
        apply_mode,
        max_discount_cents,
        min_order_cents,
        value,
        owner_user_id,
        max_uses,
        applies_to_item_id,
        expires_at,
        created_by,
        updated_by,
        is_active
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      RETURNING
        id_coupon,
        code,
        discount_type,
        scope,
        apply_mode,
        max_discount_cents,
        min_order_cents,
        value,
        owner_user_id,
        max_uses,
        applies_to_item_id,
        expires_at,
        created_at,
        created_by,
        updated_at,
        updated_by,
        is_active
      `,
      [
        data.code,
        data.discount_type,
        data.scope,
        data.apply_mode,
        data.max_discount_cents,
        data.min_order_cents,
        data.value,
        data.owner_user_id,
        data.max_uses,
        data.applies_to_item_id,
        data.expires_at,
        data.created_by,
        data.updated_by,
        data.is_active,
      ]
    );

    return result.rows[0];
  }

  static async listByUser(conn, ownerUserId, filters = {}) {
    const values = [ownerUserId];
    const conditions = [`c.owner_user_id = $1`];
    let index = 2;

    if (filters.is_active !== undefined) {
      conditions.push(`c.is_active = $${index++}`);
      values.push(filters.is_active);
    }

    if (filters.code) {
      conditions.push(`c.code ILIKE $${index++}`);
      values.push(`%${filters.code}%`);
    }

    if (filters.discount_type) {
      conditions.push(`c.discount_type = $${index++}`);
      values.push(filters.discount_type);
    }

    if (filters.scope) {
      conditions.push(`c.scope = $${index++}`);
      values.push(filters.scope);
    }

    if (filters.apply_mode) {
      conditions.push(`c.apply_mode = $${index++}`);
      values.push(filters.apply_mode);
    }

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM public.tb_coupon c
      WHERE ${conditions.join(" AND ")}
    `;

    const countResult = await conn.query(countSql, values);
    const total = countResult.rows[0].total;

    const listSql = `
      SELECT
        c.id_coupon,
        c.code,
        c.discount_type,
        c.scope,
        c.apply_mode,
        c.max_discount_cents,
        c.min_order_cents,
        c.value,
        c.owner_user_id,
        c.max_uses,
        c.applies_to_item_id,
        c.expires_at,
        c.created_at,
        c.created_by,
        c.updated_at,
        c.updated_by,
        c.is_active
      FROM public.tb_coupon c
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT $${index++}
      OFFSET $${index++}
    `;

    values.push(filters.limit || 10);
    values.push(filters.offset || 0);

    const result = await conn.query(listSql, values);

    return {
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 10)) + 1,
      limit: filters.limit || 10,
      data: result.rows,
    };
  }

  static async findByCode(conn, code) {
    const result = await conn.query(
      `
    SELECT *
    FROM public.tb_coupon
    WHERE code = $1
    LIMIT 1
    `,
      [code]
    );

    return result.rows[0];
  }
}

module.exports = CouponStorage;
