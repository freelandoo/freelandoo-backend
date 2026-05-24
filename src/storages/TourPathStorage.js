class TourPathStorage {
  // ---------- Paths ----------

  static async listPaths(conn, { onlyActive = false } = {}) {
    const where = onlyActive ? "WHERE is_active = TRUE" : "";
    const { rows } = await conn.query(
      `SELECT id, path_key, title, description, cta_label, banner_image_url, banner_object_key,
              sort_order, is_active, is_seed, version, created_at, updated_at
         FROM public.tour_monetization_paths
         ${where}
         ORDER BY sort_order ASC, title ASC`
    );
    return rows;
  }

  static async getPathById(conn, id) {
    const { rows } = await conn.query(
      `SELECT id, path_key, title, description, cta_label, banner_image_url, banner_object_key,
              sort_order, is_active, is_seed, version, created_at, updated_at
         FROM public.tour_monetization_paths
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async getPathByKey(conn, pathKey) {
    const { rows } = await conn.query(
      `SELECT id, path_key, title, description, cta_label, banner_image_url, banner_object_key,
              sort_order, is_active, is_seed, version, created_at, updated_at
         FROM public.tour_monetization_paths
        WHERE path_key = $1
        LIMIT 1`,
      [pathKey]
    );
    return rows[0] || null;
  }

  static async createPath(conn, patch) {
    const { rows } = await conn.query(
      `INSERT INTO public.tour_monetization_paths
         (path_key, title, description, cta_label, banner_image_url, banner_object_key, sort_order, is_active, is_seed, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, 1)
       RETURNING id, path_key, title, description, cta_label, banner_image_url, banner_object_key,
                 sort_order, is_active, is_seed, version, created_at, updated_at`,
      [
        patch.path_key,
        patch.title,
        patch.description,
        patch.cta_label || "Começar",
        patch.banner_image_url || null,
        patch.banner_object_key || null,
        patch.sort_order || 0,
        patch.is_active != null ? patch.is_active : true,
      ]
    );
    return rows[0];
  }

  static async updatePath(conn, id, patch) {
    const allowed = [
      "path_key",
      "title",
      "description",
      "cta_label",
      "banner_image_url",
      "banner_object_key",
      "sort_order",
      "is_active",
    ];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getPathById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.tour_monetization_paths
          SET ${fields.join(", ")}
        WHERE id = $${i}
        RETURNING id, path_key, title, description, cta_label, banner_image_url, banner_object_key,
                  sort_order, is_active, is_seed, version, created_at, updated_at`,
      values
    );
    return rows[0] || null;
  }

  static async bumpVersion(conn, pathId) {
    const { rows } = await conn.query(
      `UPDATE public.tour_monetization_paths
          SET version    = version + 1,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, path_key, version`,
      [pathId]
    );
    return rows[0] || null;
  }

  static async deletePath(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tour_monetization_paths WHERE id = $1 AND is_seed = FALSE`,
      [id]
    );
    return rowCount > 0;
  }

  // ---------- Steps ----------

  static async listStepsByPath(conn, pathId) {
    const { rows } = await conn.query(
      `SELECT id, path_id, step_order, route, target_selector, wait_for_selector, placement,
              title, content, on_enter_action, on_leave_action, created_at, updated_at
         FROM public.tour_path_steps
        WHERE path_id = $1
        ORDER BY step_order ASC`,
      [pathId]
    );
    return rows;
  }

  static async getStepById(conn, id) {
    const { rows } = await conn.query(
      `SELECT id, path_id, step_order, route, target_selector, wait_for_selector, placement,
              title, content, on_enter_action, on_leave_action, created_at, updated_at
         FROM public.tour_path_steps
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async createStep(conn, patch) {
    const { rows } = await conn.query(
      `INSERT INTO public.tour_path_steps
         (path_id, step_order, route, target_selector, wait_for_selector, placement,
          title, content, on_enter_action, on_leave_action)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, path_id, step_order, route, target_selector, wait_for_selector, placement,
                 title, content, on_enter_action, on_leave_action, created_at, updated_at`,
      [
        patch.path_id,
        patch.step_order,
        patch.route,
        patch.target_selector || null,
        patch.wait_for_selector || null,
        patch.placement || "bottom",
        patch.title,
        patch.content,
        patch.on_enter_action || null,
        patch.on_leave_action || null,
      ]
    );
    return rows[0];
  }

  static async updateStep(conn, id, patch) {
    const allowed = [
      "step_order",
      "route",
      "target_selector",
      "wait_for_selector",
      "placement",
      "title",
      "content",
      "on_enter_action",
      "on_leave_action",
    ];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getStepById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.tour_path_steps
          SET ${fields.join(", ")}
        WHERE id = $${i}
        RETURNING id, path_id, step_order, route, target_selector, wait_for_selector, placement,
                  title, content, on_enter_action, on_leave_action, created_at, updated_at`,
      values
    );
    return rows[0] || null;
  }

  static async deleteStep(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tour_path_steps WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  }

  // ---------- User progress ----------

  static async getProgress(conn, userId, pathKey) {
    const { rows } = await conn.query(
      `SELECT id, user_id, path_key, status, current_step, path_version,
              started_at, completed_at, skipped_at, created_at, updated_at
         FROM public.user_tour_path_progress
        WHERE user_id = $1 AND path_key = $2
        LIMIT 1`,
      [userId, pathKey]
    );
    return rows[0] || null;
  }

  static async listProgressByUser(conn, userId) {
    const { rows } = await conn.query(
      `SELECT id, user_id, path_key, status, current_step, path_version,
              started_at, completed_at, skipped_at, created_at, updated_at
         FROM public.user_tour_path_progress
        WHERE user_id = $1
        ORDER BY path_key ASC`,
      [userId]
    );
    return rows;
  }

  static async upsertProgress(conn, { userId, pathKey, status, currentStep, pathVersion }) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_tour_path_progress
         (user_id, path_key, status, current_step, path_version, started_at, completed_at, skipped_at, updated_at)
       VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $3 = 'in_progress' THEN NOW() ELSE NULL END,
         CASE WHEN $3 = 'completed'   THEN NOW() ELSE NULL END,
         CASE WHEN $3 = 'skipped'     THEN NOW() ELSE NULL END,
         NOW()
       )
       ON CONFLICT (user_id, path_key)
       DO UPDATE SET
         status       = EXCLUDED.status,
         current_step = EXCLUDED.current_step,
         path_version = GREATEST(public.user_tour_path_progress.path_version, EXCLUDED.path_version),
         started_at   = CASE
                          WHEN EXCLUDED.status = 'in_progress' AND public.user_tour_path_progress.started_at IS NULL
                            THEN NOW()
                          ELSE public.user_tour_path_progress.started_at
                        END,
         completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN NOW() ELSE public.user_tour_path_progress.completed_at END,
         skipped_at   = CASE WHEN EXCLUDED.status = 'skipped'   THEN NOW() ELSE public.user_tour_path_progress.skipped_at   END,
         updated_at   = NOW()
       RETURNING id, user_id, path_key, status, current_step, path_version,
                 started_at, completed_at, skipped_at, created_at, updated_at`,
      [userId, pathKey, status, currentStep, pathVersion]
    );
    return rows[0] || null;
  }
}

module.exports = TourPathStorage;
