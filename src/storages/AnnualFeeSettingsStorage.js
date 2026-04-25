class AnnualFeeSettingsStorage {
  static async get(conn) {
    const { rows } = await conn.query(
      `SELECT id, amount_cents, currency, stripe_price_id, stripe_product_id,
              is_active, created_at, updated_at, updated_by
       FROM public.tb_annual_fee_settings
       WHERE id = 1
       LIMIT 1`
    );
    return rows[0] || null;
  }

  static async update(conn, { amount_cents, currency, is_active, updated_by }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_annual_fee_settings
       SET amount_cents = COALESCE($1, amount_cents),
           currency     = COALESCE($2, currency),
           is_active    = COALESCE($3, is_active),
           updated_by   = $4,
           updated_at   = NOW()
       WHERE id = 1
       RETURNING *`,
      [amount_cents ?? null, currency ?? null, is_active ?? null, updated_by ?? null]
    );
    return rows[0];
  }

  static async setStripeIds(conn, { stripe_product_id, stripe_price_id }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_annual_fee_settings
       SET stripe_product_id = $1,
           stripe_price_id   = $2,
           updated_at        = NOW()
       WHERE id = 1
       RETURNING *`,
      [stripe_product_id, stripe_price_id]
    );
    return rows[0];
  }
}

module.exports = AnnualFeeSettingsStorage;
