class ItemStorage {
  static async create(conn, payload) {
    const result = await conn.query(
      `
            INSERT INTO public.tb_item (
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_by,
                updated_by,
                is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
                id_item,
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            `,
      [
        payload.desc_item,
        payload.details,
        payload.unity_price_cents,
        payload.currency,
        payload.created_by,
        payload.updated_by,
        payload.is_active,
      ]
    );

    return result.rows[0];
  }

  static async list(conn, filters = {}) {
    const where = [];
    const values = [];

    if (filters.is_active !== undefined) {
      values.push(filters.is_active);
      where.push(`is_active = $${values.length}`);
    }

    if (filters.q) {
      values.push(`%${filters.q}%`);
      where.push(`desc_item ILIKE $${values.length}`);
    }

    if (filters.currency) {
      values.push(filters.currency.toUpperCase());
      where.push(`currency = $${values.length}`);
    }

    values.push(filters.limit || 10);
    const limitParam = `$${values.length}`;

    values.push(filters.offset || 0);
    const offsetParam = `$${values.length}`;

    const result = await conn.query(
      `
            SELECT
                id_item,
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            FROM public.tb_item
            ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY created_at DESC
            LIMIT ${limitParam}
            OFFSET ${offsetParam}
            `,
      values
    );

    return result.rows;
  }

  static async getById(conn, id_item) {
    const result = await conn.query(
      `
            SELECT
                id_item,
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            FROM public.tb_item
            WHERE id_item = $1
            LIMIT 1
            `,
      [id_item]
    );

    return result.rows[0] || null;
  }

  static async update(conn, id_item, payload) {
    const result = await conn.query(
      `
            UPDATE public.tb_item
               SET desc_item = $2,
                   details = $3,
                   unity_price_cents = $4,
                   currency = $5,
                   is_active = $6,
                   updated_by = $7,
                   updated_at = NOW()
             WHERE id_item = $1
             RETURNING
                id_item,
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            `,
      [
        id_item,
        payload.desc_item,
        payload.details,
        payload.unity_price_cents,
        payload.currency,
        payload.is_active,
        payload.updated_by,
      ]
    );

    return result.rows[0] || null;
  }

  static async toggleActive(conn, payload) {
    const result = await conn.query(
      `
            UPDATE public.tb_item
               SET is_active = $2,
                   updated_by = $3,
                   updated_at = NOW()
             WHERE id_item = $1
             RETURNING
                id_item,
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            `,
      [payload.id_item, payload.is_active, payload.updated_by]
    );

    return result.rows[0] || null;
  }

  static async softDelete(conn, payload) {
    const result = await conn.query(
      `
            UPDATE public.tb_item
               SET is_active = false,
                   updated_by = $2,
                   updated_at = NOW()
             WHERE id_item = $1
             RETURNING
                id_item,
                desc_item,
                details,
                unity_price_cents,
                currency,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            `,
      [payload.id_item, payload.updated_by]
    );

    return result.rows[0] || null;
  }
}

module.exports = ItemStorage;
