class BookingSettingsStorage {
  static async get(conn, id_profile) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_booking_settings
       WHERE id_profile = $1 LIMIT 1`,
      [id_profile]
    );
    return r.rows[0] || null;
  }

  static async upsert(conn, {
    id_profile, deposit_amount, platform_fee_amount, currency, allow_booking,
    reminder_enabled, reminder_hours_before,
  }) {
    // Campos não enviados (null) preservam o valor atual via COALESCE no UPDATE —
    // permite salvar só o lembrete sem mexer no resto. deposit_amount é legacy.
    const r = await conn.query(
      `INSERT INTO public.tb_profile_booking_settings
        (id_profile, deposit_amount, platform_fee_amount, currency, allow_booking,
         reminder_enabled, reminder_hours_before, updated_at)
       VALUES ($1, COALESCE($2, 1000), COALESCE($3, 1000), COALESCE($4, 'BRL'), COALESCE($5, FALSE),
               COALESCE($6, TRUE), COALESCE($7, 24), NOW())
       ON CONFLICT (id_profile) DO UPDATE SET
        deposit_amount        = COALESCE(EXCLUDED.deposit_amount, public.tb_profile_booking_settings.deposit_amount),
        platform_fee_amount   = COALESCE(EXCLUDED.platform_fee_amount, public.tb_profile_booking_settings.platform_fee_amount),
        currency              = COALESCE(EXCLUDED.currency, public.tb_profile_booking_settings.currency),
        allow_booking         = COALESCE(EXCLUDED.allow_booking, public.tb_profile_booking_settings.allow_booking),
        reminder_enabled      = COALESCE($6, public.tb_profile_booking_settings.reminder_enabled),
        reminder_hours_before = COALESCE($7, public.tb_profile_booking_settings.reminder_hours_before),
        updated_at            = NOW()
       RETURNING *`,
      [
        id_profile,
        deposit_amount ?? null,
        platform_fee_amount ?? null,
        currency ?? null,
        allow_booking == null ? null : !!allow_booking,
        reminder_enabled == null ? null : !!reminder_enabled,
        reminder_hours_before ?? null,
      ]
    );
    return r.rows[0];
  }
}

module.exports = BookingSettingsStorage;
