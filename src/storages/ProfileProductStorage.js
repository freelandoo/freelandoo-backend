class ProfileProductStorage {
  static async list(conn, id_profile, opts = {}) {
    const {
      only_active = false,
      id_product_category = null,
      min_price_cents = null,
      max_price_cents = null,
      sort = "recent", // recent | price_asc | price_desc
    } = opts;
    const where = ["id_profile = $1", "deleted_at IS NULL"];
    const params = [id_profile];
    let i = 2;
    if (only_active) {
      where.push("is_active = TRUE");
      where.push("moderation_status = 'active'");
    }
    if (id_product_category) {
      where.push(`id_product_category = $${i++}`);
      params.push(id_product_category);
    }
    if (min_price_cents != null) {
      where.push(`price_amount >= $${i++}`);
      params.push(min_price_cents);
    }
    if (max_price_cents != null) {
      where.push(`price_amount <= $${i++}`);
      params.push(max_price_cents);
    }
    const orderBy =
      sort === "price_asc" ? "price_amount ASC" :
      sort === "price_desc" ? "price_amount DESC" :
      "created_at DESC";
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_product
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderBy}`,
      params
    );
    return r.rows;
  }

  static async getById(conn, id_profile_product) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_product
       WHERE id_profile_product = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [id_profile_product]
    );
    return r.rows[0] || null;
  }

  static async create(conn, {
    id_profile, name, description, price_amount, stock_quantity,
    weight_grams, height_cm, width_cm, length_cm,
    origin_zipcode_override, is_active, id_product_category,
    affiliates_allowed = false,
    delivery_mode = "shipping",
    attributes = {},
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_product
        (id_profile, name, description, price_amount, stock_quantity,
         weight_grams, height_cm, width_cm, length_cm,
         origin_zipcode_override, is_active, id_product_category,
         affiliates_allowed, delivery_mode, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        id_profile, name, description || null,
        price_amount, stock_quantity,
        weight_grams, height_cm, width_cm, length_cm,
        origin_zipcode_override || null,
        is_active !== false,
        id_product_category || null,
        affiliates_allowed === true,
        delivery_mode === "local_pickup" ? "local_pickup" : "shipping",
        JSON.stringify(attributes && typeof attributes === "object" ? attributes : {}),
      ]
    );
    return r.rows[0];
  }

  static async update(conn, id_profile_product, fields) {
    const allowed = [
      "name", "description", "price_amount", "stock_quantity",
      "weight_grams", "height_cm", "width_cm", "length_cm",
      "origin_zipcode_override", "is_active", "id_product_category",
      "affiliates_allowed", "delivery_mode", "attributes",
    ];
    const sets = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = $${i++}`);
        values.push(k === "attributes" ? JSON.stringify(fields[k] || {}) : fields[k]);
      }
    }
    if (sets.length === 0) return null;
    sets.push(`updated_at = NOW()`);
    values.push(id_profile_product);
    const r = await conn.query(
      `UPDATE public.tb_profile_product
       SET ${sets.join(", ")}
       WHERE id_profile_product = $${i} AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    return r.rows[0] || null;
  }

  static async softDelete(conn, id_profile_product) {
    const r = await conn.query(
      `UPDATE public.tb_profile_product
       SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
       WHERE id_profile_product = $1 AND deleted_at IS NULL
       RETURNING id_profile_product`,
      [id_profile_product]
    );
    return r.rowCount > 0;
  }

  static async decrementStock(conn, id_profile_product, qty) {
    const r = await conn.query(
      `UPDATE public.tb_profile_product
       SET stock_quantity = stock_quantity - $2, updated_at = NOW()
       WHERE id_profile_product = $1
         AND deleted_at IS NULL
         AND stock_quantity >= $2
       RETURNING *`,
      [id_profile_product, qty]
    );
    return r.rows[0] || null;
  }

  /**
   * Retorna o produto e o id_user dono via JOIN com tb_profile.
   * Usado pelo checkout pra resolver vendedor e validar subscription ativa.
   */
  static async getWithOwner(conn, id_profile_product) {
    const r = await conn.query(
      `SELECT pp.*,
              pr.id_user AS owner_id_user,
              pr.origin_zipcode AS profile_origin_zipcode,
              pr.origin_document AS profile_origin_document,
              pr.origin_number AS profile_origin_number,
              pr.origin_complement AS profile_origin_complement,
              pr.is_clan AS profile_is_clan,
              (SELECT TRUE FROM public.tb_profile_subscription psub
                WHERE psub.id_profile = pp.id_profile
                  AND psub.status = 'active'
                LIMIT 1) AS profile_is_paid
         FROM public.tb_profile_product pp
         JOIN public.tb_profile pr ON pr.id_profile = pp.id_profile
        WHERE pp.id_profile_product = $1
          AND pp.deleted_at IS NULL
        LIMIT 1`,
      [id_profile_product]
    );
    return r.rows[0] || null;
  }
}

module.exports = ProfileProductStorage;
