class PremiumStorage {
  // ---------- Settings ----------

  static async getSettings(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.premium_settings WHERE id = 1 LIMIT 1`
    );
    return rows[0] || null;
  }

  static async updateSettings(conn, patch) {
    const allowed = ["duration_days", "price_cents", "price_polens", "slots_per_city", "is_active"];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getSettings(conn);
    fields.push("updated_at = NOW()");
    const { rows } = await conn.query(
      `UPDATE public.premium_settings SET ${fields.join(", ")} WHERE id = 1 RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  // ---------- City overrides ----------

  static async listCityOverrides(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.premium_city_overrides ORDER BY uf ASC, city_name ASC`
    );
    return rows;
  }

  static async getCityOverride(conn, { uf, city_name }) {
    if (!uf || !city_name) return null;
    const { rows } = await conn.query(
      `SELECT * FROM public.premium_city_overrides
        WHERE uf = $1 AND lower(city_name) = lower($2)
        LIMIT 1`,
      [uf, city_name]
    );
    return rows[0] || null;
  }

  static async getCityOverrideById(conn, id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.premium_city_overrides WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async upsertCityOverride(conn, data) {
    const { uf, city_name, price_cents, price_polens, slots } = data;
    const { rows } = await conn.query(
      `INSERT INTO public.premium_city_overrides
         (uf, city_name, price_cents, price_polens, slots)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uf, lower(city_name)) DO UPDATE
          SET price_cents = EXCLUDED.price_cents,
              price_polens = EXCLUDED.price_polens,
              slots = EXCLUDED.slots,
              updated_at = NOW()
       RETURNING *`,
      [uf, city_name, price_cents ?? null, price_polens ?? null, slots ?? null]
    );
    return rows[0];
  }

  static async deleteCityOverride(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.premium_city_overrides WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  }

  // ---------- Profile premium activations ----------

  static async expireInactive(conn, profileId = null) {
    const params = [];
    let where = "";
    if (profileId) {
      params.push(profileId);
      where = `AND profile_id = $1`;
    }
    await conn.query(
      `UPDATE public.profile_premium
          SET is_active = FALSE,
              status = 'expired',
              updated_at = NOW()
        WHERE is_active = TRUE
          AND expires_at IS NOT NULL
          AND expires_at <= NOW()
          ${where}`,
      params
    );
  }

  static async getActiveForProfile(conn, profileId) {
    await this.expireInactive(conn, profileId);
    const { rows } = await conn.query(
      `SELECT * FROM public.profile_premium
        WHERE profile_id = $1 AND is_active = TRUE
        ORDER BY activated_at DESC
        LIMIT 1`,
      [profileId]
    );
    return rows[0] || null;
  }

  static async hasActiveForProfile(conn, profileId) {
    return !!(await this.getActiveForProfile(conn, profileId));
  }

  static async countActiveByCity(conn, { uf, city_name }) {
    if (!uf || !city_name) return 0;
    await this.expireInactive(conn);
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS total
         FROM public.profile_premium
        WHERE is_active = TRUE
          AND uf = $1
          AND lower(city_name) = lower($2)`,
      [uf, city_name]
    );
    return rows[0]?.total || 0;
  }

  static async createPending(conn, data) {
    const { rows } = await conn.query(
      `INSERT INTO public.profile_premium
         (profile_id, status, payment_method, amount_cents, amount_polens,
          stripe_session_id, uf, city_name)
       VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.profile_id,
        data.payment_method,
        data.amount_cents ?? null,
        data.amount_polens ?? null,
        data.stripe_session_id ?? null,
        data.uf,
        data.city_name,
      ]
    );
    return rows[0];
  }

  static async activate(conn, id, { duration_days, stripe_payment_intent }) {
    const { rows } = await conn.query(
      `UPDATE public.profile_premium
          SET status = 'active',
              is_active = TRUE,
              activated_at = NOW(),
              expires_at = NOW() + ($2::int * INTERVAL '1 day'),
              stripe_payment_intent = COALESCE($3, stripe_payment_intent),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, duration_days, stripe_payment_intent || null]
    );
    return rows[0] || null;
  }

  static async markFailed(conn, id) {
    const { rows } = await conn.query(
      `UPDATE public.profile_premium
          SET status = 'failed',
              is_active = FALSE,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async getByStripeSession(conn, sessionId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.profile_premium WHERE stripe_session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return rows[0] || null;
  }

  static async getByPaymentIntent(conn, paymentIntentId) {
    if (!paymentIntentId) return null;
    const { rows } = await conn.query(
      `SELECT * FROM public.profile_premium WHERE stripe_payment_intent = $1 LIMIT 1`,
      [paymentIntentId]
    );
    return rows[0] || null;
  }

  static async markRefunded(conn, id) {
    const { rows } = await conn.query(
      `UPDATE public.profile_premium
          SET status = CASE WHEN status = 'active' THEN 'expired' ELSE 'failed' END,
              is_active = FALSE,
              refunded_at = COALESCE(refunded_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async listActive(conn, { limit = 50, offset = 0, q = "" } = {}) {
    await this.expireInactive(conn);
    const params = [];
    let i = 1;
    let search = "";
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      search = `AND (
        LOWER(COALESCE(p.display_name, '')) LIKE $${i} OR
        LOWER(COALESCE(u.username, '')) LIKE $${i} OR
        LOWER(COALESCE(pp.city_name, '')) LIKE $${i}
      )`;
      i += 1;
    }
    params.push(limit, offset);
    const { rows } = await conn.query(
      `SELECT pp.*,
              p.display_name,
              p.avatar_url,
              u.username
         FROM public.profile_premium pp
         JOIN public.tb_profile p ON p.id_profile = pp.profile_id
         LEFT JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE pp.is_active = TRUE
        ${search}
        ORDER BY pp.expires_at ASC
        LIMIT $${i} OFFSET $${i + 1}`,
      params
    );
    return rows;
  }

  // ---------- Helpers ----------

  /**
   * Resolve preço/vagas para uma cidade aplicando override → settings default.
   * Retorna { price_cents, price_polens, slots, override_id }.
   */
  static async resolvePricing(conn, { uf, city_name }) {
    const settings = await this.getSettings(conn);
    if (!settings) return null;
    const override = uf && city_name
      ? await this.getCityOverride(conn, { uf, city_name })
      : null;
    return {
      duration_days: settings.duration_days,
      price_cents: override?.price_cents ?? settings.price_cents,
      price_polens: override?.price_polens ?? settings.price_polens,
      slots: override?.slots ?? settings.slots_per_city,
      override_id: override?.id || null,
      is_active: settings.is_active,
    };
  }
}

module.exports = PremiumStorage;
