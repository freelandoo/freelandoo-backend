class BookingAvailabilityStorage {
  // ─── Regras semanais ───────────────────────────────────────────────
  static async getWeeklyRules(conn, id_profile) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_availability_rules
       WHERE id_profile = $1
       ORDER BY weekday`,
      [id_profile]
    );
    return r.rows;
  }

  static async upsertWeeklyRule(conn, { id_profile, weekday, is_enabled, start_time, end_time, slot_duration_minutes, buffer_minutes }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_availability_rules
        (id_profile, weekday, is_enabled, start_time, end_time, slot_duration_minutes, buffer_minutes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id_profile, weekday) DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        slot_duration_minutes = EXCLUDED.slot_duration_minutes,
        buffer_minutes = EXCLUDED.buffer_minutes,
        updated_at = NOW()
       RETURNING *`,
      [id_profile, weekday, is_enabled, start_time, end_time, slot_duration_minutes, buffer_minutes]
    );
    return r.rows[0];
  }

  // ─── Exceções por data ─────────────────────────────────────────────
  static async getOverrides(conn, id_profile) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_availability_overrides
       WHERE id_profile = $1
       ORDER BY override_date`,
      [id_profile]
    );
    return r.rows;
  }

  static async getOverrideByDate(conn, id_profile, override_date) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_availability_overrides
       WHERE id_profile = $1 AND override_date = $2
       LIMIT 1`,
      [id_profile, override_date]
    );
    return r.rows[0] || null;
  }

  static async upsertOverride(conn, {
    id_profile, override_date, is_day_blocked,
    custom_start_time, custom_end_time,
    extra_slots_json, blocked_slots_json, note
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_availability_overrides
        (id_profile, override_date, is_day_blocked, custom_start_time, custom_end_time,
         extra_slots_json, blocked_slots_json, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id_profile, override_date) DO UPDATE SET
        is_day_blocked     = EXCLUDED.is_day_blocked,
        custom_start_time  = EXCLUDED.custom_start_time,
        custom_end_time    = EXCLUDED.custom_end_time,
        extra_slots_json   = EXCLUDED.extra_slots_json,
        blocked_slots_json = EXCLUDED.blocked_slots_json,
        note               = EXCLUDED.note,
        updated_at         = NOW()
       RETURNING *`,
      [id_profile, override_date, is_day_blocked,
       custom_start_time || null, custom_end_time || null,
       extra_slots_json ? JSON.stringify(extra_slots_json) : null,
       blocked_slots_json ? JSON.stringify(blocked_slots_json) : null,
       note || null]
    );
    return r.rows[0];
  }

  static async deleteOverride(conn, id, id_profile) {
    const r = await conn.query(
      `DELETE FROM public.tb_profile_availability_overrides
       WHERE id = $1 AND id_profile = $2
       RETURNING id`,
      [id, id_profile]
    );
    return r.rowCount > 0;
  }

  // ─── Regra para uma data específica (combinando geral + override) ──
  /**
   * Escopo da agenda de um perfil (mig 190). A agenda é da CONTA, não do
   * perfil: uma pessoa tem um corpo e uma hora só, então dois perfis do mesmo
   * dono não podem vender o mesmo horário.
   *  - agendaProfileId: onde moram as regras/exceções (o perfil-conta).
   *  - profileIds: todos os perfis do dono — é o escopo de ocupação/conflito.
   * Clan tem agenda própria: é uma entidade coletiva, não o corpo do líder.
   */
  static async resolveAgendaScope(conn, id_profile) {
    const own = { agendaProfileId: id_profile, profileIds: [id_profile] };
    const target = await conn.query(
      `SELECT id_profile, id_user, COALESCE(is_clan, FALSE) AS is_clan
         FROM public.tb_profile WHERE id_profile = $1`,
      [id_profile]
    );
    const row = target.rows[0];
    if (!row || row.is_clan || !row.id_user) return own;

    const siblings = await conn.query(
      `SELECT id_profile, COALESCE(is_user_account, FALSE) AS is_user_account
         FROM public.tb_profile
        WHERE id_user = $1 AND COALESCE(is_clan, FALSE) = FALSE AND deleted_at IS NULL`,
      [row.id_user]
    );
    if (siblings.rowCount === 0) return own;

    const account = siblings.rows.find((r) => r.is_user_account);
    const profileIds = siblings.rows.map((r) => r.id_profile);
    // Defensivo: o perfil pedido pode estar soft-deleted e fora da lista.
    if (!profileIds.includes(id_profile)) profileIds.push(id_profile);

    return {
      agendaProfileId: account ? account.id_profile : id_profile,
      profileIds,
    };
  }

  static async getRuleForDate(conn, id_profile, date, weekday) {
    const override = await this.getOverrideByDate(conn, id_profile, date);
    if (override) return { type: "override", data: override };

    const r = await conn.query(
      `SELECT * FROM public.tb_profile_availability_rules
       WHERE id_profile = $1 AND weekday = $2
       LIMIT 1`,
      [id_profile, weekday]
    );
    if (r.rows[0]) return { type: "weekly", data: r.rows[0] };

    return { type: "none", data: null };
  }
}

module.exports = BookingAvailabilityStorage;
