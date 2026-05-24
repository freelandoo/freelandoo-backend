class MonetizationIntentStorage {
  static async listActivePaths(conn) {
    const { rows } = await conn.query(
      `SELECT id, path_key, title, description, cta_label, accent_color,
              video_url, poster_url, banner_image_url, sort_order
         FROM public.tour_monetization_paths
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, title ASC`
    );
    return rows;
  }

  static async getPathByKey(conn, pathKey) {
    const { rows } = await conn.query(
      `SELECT id, path_key, title, video_url, poster_url, accent_color
         FROM public.tour_monetization_paths
        WHERE path_key = $1 AND is_active = TRUE
        LIMIT 1`,
      [pathKey]
    );
    return rows[0] || null;
  }

  static async getState(conn, userId) {
    const { rows } = await conn.query(
      `SELECT user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at
         FROM public.user_onboarding_monetization_state
        WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
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
       RETURNING user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at`,
      [userId, reason]
    );
    return rows[0] || null;
  }

  static async choose(conn, userId, pathKey) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_onboarding_monetization_state
         (user_id, selected_path_key, selected_at, dismissed_at, dismissed_reason, updated_at)
       VALUES ($1, $2, NOW(), NOW(), 'closed', NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         selected_path_key = EXCLUDED.selected_path_key,
         selected_at       = NOW(),
         dismissed_at      = COALESCE(public.user_onboarding_monetization_state.dismissed_at, NOW()),
         dismissed_reason  = COALESCE(public.user_onboarding_monetization_state.dismissed_reason, 'closed'),
         updated_at        = NOW()
       RETURNING user_id, dismissed_at, dismissed_reason, selected_path_key, selected_at`,
      [userId, pathKey]
    );
    return rows[0] || null;
  }
}

module.exports = MonetizationIntentStorage;
