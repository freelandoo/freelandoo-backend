class BookingSettingsStorage {
  static async get(conn, id_profile) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_booking_settings
       WHERE id_profile = $1 LIMIT 1`,
      [id_profile]
    );
    return r.rows[0] || null;
  }

  static async upsert(conn, { id_profile, deposit_amount, platform_fee_amount, currency, allow_booking }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_booking_settings
        (id_profile, deposit_amount, platform_fee_amount, currency, allow_booking, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id_profile) DO UPDATE SET
        deposit_amount      = EXCLUDED.deposit_amount,
        platform_fee_amount = EXCLUDED.platform_fee_amount,
        currency            = EXCLUDED.currency,
        allow_booking       = EXCLUDED.allow_booking,
        updated_at          = NOW()
       RETURNING *`,
      [id_profile, deposit_amount, platform_fee_amount || 1000, currency || 'BRL', allow_booking ?? false]
    );
    return r.rows[0];
  }
}

module.exports = BookingSettingsStorage;
