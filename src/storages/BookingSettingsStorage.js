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
    // deposit_amount é legacy. Se não vier, mantém o existente (ou default 1000).
    const r = await conn.query(
      `INSERT INTO public.tb_profile_booking_settings
        (id_profile, deposit_amount, platform_fee_amount, currency, allow_booking, updated_at)
       VALUES ($1, COALESCE($2, 1000), COALESCE($3, 1000), COALESCE($4, 'BRL'), COALESCE($5, FALSE), NOW())
       ON CONFLICT (id_profile) DO UPDATE SET
        deposit_amount      = COALESCE(EXCLUDED.deposit_amount, public.tb_profile_booking_settings.deposit_amount),
        platform_fee_amount = COALESCE(EXCLUDED.platform_fee_amount, public.tb_profile_booking_settings.platform_fee_amount),
        currency            = COALESCE(EXCLUDED.currency, public.tb_profile_booking_settings.currency),
        allow_booking       = COALESCE(EXCLUDED.allow_booking, public.tb_profile_booking_settings.allow_booking),
        updated_at          = NOW()
       RETURNING *`,
      [
        id_profile,
        deposit_amount ?? null,
        platform_fee_amount ?? null,
        currency ?? null,
        allow_booking == null ? null : !!allow_booking,
      ]
    );
    return r.rows[0];
  }
}

module.exports = BookingSettingsStorage;
