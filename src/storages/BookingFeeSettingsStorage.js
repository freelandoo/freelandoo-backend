class BookingFeeSettingsStorage {
  static async get(conn) {
    const { rows } = await conn.query(
      `SELECT id, stripe_fee_percent, service_fee_cents, is_active, created_at, updated_at, updated_by
       FROM public.tb_booking_fee_settings
       WHERE id = 1
       LIMIT 1`
    );
    return rows[0] || null;
  }

  static async update(conn, { stripe_fee_percent, service_fee_cents, is_active, updated_by }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_booking_fee_settings
       SET stripe_fee_percent = COALESCE($1, stripe_fee_percent),
           service_fee_cents  = COALESCE($2, service_fee_cents),
           is_active          = COALESCE($3, is_active),
           updated_by         = $4,
           updated_at         = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        stripe_fee_percent != null ? Number(stripe_fee_percent) : null,
        service_fee_cents  != null ? Number(service_fee_cents)  : null,
        is_active != null ? is_active : null,
        updated_by ?? null,
      ]
    );
    return rows[0];
  }
}

module.exports = BookingFeeSettingsStorage;
