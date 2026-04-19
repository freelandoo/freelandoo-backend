class CouponAdminStorage {
  // ───────── Discount settings (versionado, latest = vigente) ─────────
  static async getEffectiveDiscountSettings(conn, at = null) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM public.tb_coupon_discount_settings
      WHERE effective_from <= COALESCE($1, NOW())
      ORDER BY effective_from DESC
      LIMIT 1
      `,
      [at]
    );
    return rows[0] || null;
  }

  static async listDiscountSettings(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_coupon_discount_settings ORDER BY effective_from DESC`
    );
    return rows;
  }

  static async createDiscountSettings(conn, data) {
    const {
      discount_type,
      discount_value,
      max_discount_cents = null,
      is_active = true,
      notes = null,
      created_by = null,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_coupon_discount_settings
        (discount_type, discount_value, max_discount_cents, is_active, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [discount_type, discount_value, max_discount_cents, is_active, notes, created_by]
    );
    return rows[0];
  }

  // ───────── Discount override por cupom ─────────
  static async getDiscountOverride(conn, id_coupon) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_coupon_discount_override
       WHERE id_coupon = $1 AND is_active = TRUE
       LIMIT 1`,
      [id_coupon]
    );
    return rows[0] || null;
  }

  static async upsertDiscountOverride(conn, data) {
    const {
      id_coupon,
      discount_type = null,
      discount_value = null,
      max_discount_cents = null,
      created_by = null,
      updated_by = null,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_coupon_discount_override
        (id_coupon, discount_type, discount_value, max_discount_cents, created_by, updated_by, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      ON CONFLICT (id_coupon) DO UPDATE SET
        discount_type      = EXCLUDED.discount_type,
        discount_value     = EXCLUDED.discount_value,
        max_discount_cents = EXCLUDED.max_discount_cents,
        updated_by         = EXCLUDED.updated_by,
        updated_at         = NOW(),
        is_active          = TRUE
      RETURNING *
      `,
      [id_coupon, discount_type, discount_value, max_discount_cents, created_by, updated_by]
    );
    return rows[0];
  }

  static async deleteDiscountOverride(conn, id_coupon) {
    await conn.query(
      `UPDATE public.tb_coupon_discount_override
       SET is_active = FALSE, updated_at = NOW()
       WHERE id_coupon = $1`,
      [id_coupon]
    );
    return { ok: true };
  }

  // ───────── Busca de cupom para admin (por código) ─────────
  static async searchByCode(conn, code) {
    const { rows } = await conn.query(
      `
      SELECT
        c.id_coupon,
        c.code,
        c.discount_type,
        c.value,
        c.max_discount_cents,
        c.min_order_cents,
        c.scope,
        c.apply_mode,
        c.owner_user_id,
        c.applies_to_item_id,
        c.expires_at,
        c.is_active,
        c.created_at,
        u.nome  AS owner_name,
        u.email AS owner_email
      FROM public.tb_coupon c
      LEFT JOIN public.tb_user u ON u.id_user = c.owner_user_id
      WHERE UPPER(c.code) = UPPER($1)
      LIMIT 1
      `,
      [code]
    );
    return rows[0] || null;
  }
}

module.exports = CouponAdminStorage;
