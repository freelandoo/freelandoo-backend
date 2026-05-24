class MonetizationOnboardingStorage {
  static async getState(conn, userId) {
    const { rows } = await conn.query(
      `SELECT user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at,
              active_tour_path_key, created_at, updated_at
         FROM public.user_onboarding_monetization_state
        WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  }

  static async ensureRow(conn, userId) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_onboarding_monetization_state (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at,
                 active_tour_path_key, created_at, updated_at`,
      [userId]
    );
    if (rows[0]) return rows[0];
    return this.getState(conn, userId);
  }

  static async dismiss(conn, userId, reason) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_onboarding_monetization_state (user_id, dismissed_at, dismissed_reason, updated_at)
       VALUES ($1, NOW(), $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         dismissed_at     = COALESCE(public.user_onboarding_monetization_state.dismissed_at, NOW()),
         dismissed_reason = COALESCE(public.user_onboarding_monetization_state.dismissed_reason, EXCLUDED.dismissed_reason),
         updated_at       = NOW()
       RETURNING user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at,
                 active_tour_path_key, created_at, updated_at`,
      [userId, reason]
    );
    return rows[0] || null;
  }

  static async selectPath(conn, userId, pathKey) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_onboarding_monetization_state
         (user_id, selected_path_key, selected_at, active_tour_path_key, dismissed_at, dismissed_reason, updated_at)
       VALUES ($1, $2, NOW(), $2, NOW(), 'closed', NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         selected_path_key    = EXCLUDED.selected_path_key,
         selected_at          = NOW(),
         active_tour_path_key = EXCLUDED.active_tour_path_key,
         dismissed_at         = COALESCE(public.user_onboarding_monetization_state.dismissed_at, NOW()),
         dismissed_reason     = COALESCE(public.user_onboarding_monetization_state.dismissed_reason, 'closed'),
         updated_at           = NOW()
       RETURNING user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at,
                 active_tour_path_key, created_at, updated_at`,
      [userId, pathKey]
    );
    return rows[0] || null;
  }

  static async clearActiveTour(conn, userId) {
    const { rows } = await conn.query(
      `UPDATE public.user_onboarding_monetization_state
          SET active_tour_path_key = NULL,
              updated_at           = NOW()
        WHERE user_id = $1
        RETURNING user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at,
                  active_tour_path_key, created_at, updated_at`,
      [userId]
    );
    return rows[0] || null;
  }
}

module.exports = MonetizationOnboardingStorage;
