class UserTourProgressStorage {
  static async listByUser(conn, userId) {
    const { rows } = await conn.query(
      `
      SELECT id, user_id, tour_key, status, current_step, completed_at, skipped_at, created_at, updated_at
      FROM public.user_tour_progress
      WHERE user_id = $1
      ORDER BY tour_key ASC
      `,
      [userId]
    );
    return rows;
  }

  static async upsertStatus(conn, { userId, tourKey, status, currentStep }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.user_tour_progress (user_id, tour_key, status, current_step, completed_at, skipped_at, updated_at)
      VALUES (
        $1, $2, $3, $4,
        CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END,
        CASE WHEN $3 = 'skipped' THEN NOW() ELSE NULL END,
        NOW()
      )
      ON CONFLICT (user_id, tour_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        current_step = EXCLUDED.current_step,
        completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN NOW() ELSE user_tour_progress.completed_at END,
        skipped_at = CASE WHEN EXCLUDED.status = 'skipped' THEN NOW() ELSE user_tour_progress.skipped_at END,
        updated_at = NOW()
      RETURNING id, user_id, tour_key, status, current_step, completed_at, skipped_at, created_at, updated_at
      `,
      [userId, tourKey, status, currentStep]
    );
    return rows[0] || null;
  }

  static async resetTour(conn, { userId, tourKey }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.user_tour_progress (user_id, tour_key, status, current_step, completed_at, skipped_at, updated_at)
      VALUES ($1, $2, 'not_started', 0, NULL, NULL, NOW())
      ON CONFLICT (user_id, tour_key)
      DO UPDATE SET
        status = 'not_started',
        current_step = 0,
        completed_at = NULL,
        skipped_at = NULL,
        updated_at = NOW()
      RETURNING id, user_id, tour_key, status, current_step, completed_at, skipped_at, created_at, updated_at
      `,
      [userId, tourKey]
    );
    return rows[0] || null;
  }

  static async getSettings(conn, userId) {
    const { rows } = await conn.query(
      `
      SELECT user_id, hide_all_tours, created_at, updated_at
      FROM public.user_tour_settings
      WHERE user_id = $1
      `,
      [userId]
    );
    return rows[0] || null;
  }

  static async upsertSettings(conn, { userId, hideAllTours }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.user_tour_settings (user_id, hide_all_tours, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        hide_all_tours = EXCLUDED.hide_all_tours,
        updated_at = NOW()
      RETURNING user_id, hide_all_tours, created_at, updated_at
      `,
      [userId, hideAllTours]
    );
    return rows[0] || null;
  }
}

module.exports = UserTourProgressStorage;
