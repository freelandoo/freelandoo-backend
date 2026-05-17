class ChatModerationStorage {
  // ─── blocked_terms ─────────────────────────────────────────────────────────
  static async listActiveTerms(conn) {
    const r = await conn.query(
      `SELECT id_blocked_term, term, normalized_term, category, severity,
              action, language, is_regex
         FROM public.tb_blocked_term
        WHERE status = 'active'
        ORDER BY severity DESC, category ASC`
    );
    return r.rows;
  }

  static async listTermsAdmin(conn, { q, category, status, limit = 100, offset = 0 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(term ILIKE $${params.length} OR normalized_term ILIKE $${params.length} OR notes ILIKE $${params.length})`);
    }
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    if (status)   { params.push(status);   where.push(`status = $${params.length}`); }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT * FROM public.tb_blocked_term
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async createTerm(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_blocked_term
         (term, normalized_term, category, severity, action, language, is_regex, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (normalized_term, language) DO UPDATE
         SET term = EXCLUDED.term,
             category = EXCLUDED.category,
             severity = EXCLUDED.severity,
             action = EXCLUDED.action,
             is_regex = EXCLUDED.is_regex,
             status = EXCLUDED.status,
             notes = EXCLUDED.notes,
             updated_at = NOW()
       RETURNING *`,
      [
        data.term, data.normalized_term, data.category, data.severity,
        data.action, data.language || "pt-BR",
        !!data.is_regex, data.status || "active", data.notes || null,
      ]
    );
    return r.rows[0];
  }

  static async updateTerm(conn, id_blocked_term, patch) {
    const fields = [];
    const values = [];
    const allow = ["term","normalized_term","category","severity","action","language","is_regex","status","notes"];
    for (const k of allow) {
      if (patch[k] !== undefined) {
        values.push(patch[k]);
        fields.push(`${k} = $${values.length}`);
      }
    }
    if (fields.length === 0) return null;
    values.push(id_blocked_term);
    const r = await conn.query(
      `UPDATE public.tb_blocked_term
          SET ${fields.join(", ")}, updated_at = NOW()
        WHERE id_blocked_term = $${values.length}
        RETURNING *`,
      values
    );
    return r.rows[0] || null;
  }

  static async deleteTerm(conn, id_blocked_term) {
    const r = await conn.query(
      `DELETE FROM public.tb_blocked_term WHERE id_blocked_term = $1 RETURNING id_blocked_term`,
      [id_blocked_term]
    );
    return r.rows[0] || null;
  }

  // ─── moderation_settings ──────────────────────────────────────────────────
  static async getSettings(conn, room_type) {
    const r = await conn.query(
      `SELECT * FROM public.tb_chat_moderation_settings WHERE room_type = $1`,
      [room_type]
    );
    return r.rows[0] || null;
  }

  static async updateSettings(conn, room_type, patch) {
    const allow = [
      "max_message_length","max_messages_per_window","window_seconds",
      "auto_hide_report_threshold","review_report_threshold",
      "mute_temp_minutes","ban_temp_minutes","score_thresholds","active",
    ];
    const fields = [];
    const values = [];
    for (const k of allow) {
      if (patch[k] !== undefined) {
        values.push(k === "score_thresholds" ? JSON.stringify(patch[k]) : patch[k]);
        fields.push(`${k} = $${values.length}`);
      }
    }
    if (fields.length === 0) return await ChatModerationStorage.getSettings(conn, room_type);
    values.push(room_type);
    const r = await conn.query(
      `UPDATE public.tb_chat_moderation_settings
          SET ${fields.join(", ")}, updated_at = NOW()
        WHERE room_type = $${values.length}
        RETURNING *`,
      values
    );
    return r.rows[0] || null;
  }

  // ─── moderation_result ────────────────────────────────────────────────────
  static async insertResult(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_chat_moderation_result
         (id_chat_message, id_chat_room, id_user, original_text, normalized_text,
          action, risk_score, flags, matched_terms, reason, review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        data.id_chat_message || null, data.id_chat_room || null, data.id_user,
        data.original_text, data.normalized_text,
        data.action, data.risk_score || 0,
        JSON.stringify(data.flags || []),
        JSON.stringify(data.matched_terms || []),
        data.reason || null,
        data.review_status || "none",
      ]
    );
    return r.rows[0];
  }

  static async listResultsAdmin(conn, { action, review_status, q, limit = 50, offset = 0 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (action)        { params.push(action);        where.push(`r.action = $${params.length}`); }
    if (review_status) { params.push(review_status); where.push(`r.review_status = $${params.length}`); }
    if (q)             { params.push(`%${q}%`);      where.push(`(r.original_text ILIKE $${params.length} OR u.username ILIKE $${params.length})`); }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT r.*,
              u.username AS user_username,
              u.nome     AS user_nome,
              room.type  AS room_type,
              room.internal_name AS room_internal_name
         FROM public.tb_chat_moderation_result r
         JOIN public.tb_user u ON u.id_user = r.id_user
         LEFT JOIN public.tb_chat_room room ON room.id_chat_room = r.id_chat_room
        WHERE ${where.join(" AND ")}
        ORDER BY r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async setReviewDecision(conn, id_moderation_result, { decision, reviewer_id }) {
    const r = await conn.query(
      `UPDATE public.tb_chat_moderation_result
          SET review_status = $2,
              reviewed_by   = $3,
              reviewed_at   = NOW()
        WHERE id_moderation_result = $1
        RETURNING *`,
      [id_moderation_result, decision, reviewer_id]
    );
    return r.rows[0] || null;
  }

  // ─── user_moderation_state ────────────────────────────────────────────────
  static async getUserState(conn, id_user) {
    const r = await conn.query(
      `SELECT * FROM public.tb_chat_user_moderation_state WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async upsertUserState(conn, id_user, patch) {
    const allow = ["public_chat_muted_until","public_chat_banned_until","last_violation_at","notes"];
    const setCols = ["id_user"];
    const setVals = [id_user];
    for (const k of allow) {
      if (patch[k] !== undefined) {
        setCols.push(k);
        setVals.push(patch[k]);
      }
    }
    const placeholders = setVals.map((_, i) => `$${i + 1}`).join(", ");
    const updates = setCols
      .filter((c) => c !== "id_user")
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");
    const incrementWarning = patch._increment_warning ? ", warning_count = COALESCE(public.tb_chat_user_moderation_state.warning_count,0) + 1" : "";
    const r = await conn.query(
      `INSERT INTO public.tb_chat_user_moderation_state (${setCols.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (id_user) DO UPDATE
         SET ${updates}${incrementWarning}, updated_at = NOW()
       RETURNING *`,
      setVals
    );
    return r.rows[0];
  }

  static async muteUser(conn, id_user, minutes, notes) {
    const r = await conn.query(
      `INSERT INTO public.tb_chat_user_moderation_state
         (id_user, public_chat_muted_until, last_violation_at, notes)
       VALUES ($1, NOW() + ($2 || ' minutes')::interval, NOW(), $3)
       ON CONFLICT (id_user) DO UPDATE
         SET public_chat_muted_until = GREATEST(
               COALESCE(public.tb_chat_user_moderation_state.public_chat_muted_until, NOW()),
               EXCLUDED.public_chat_muted_until
             ),
             last_violation_at = NOW(),
             warning_count = COALESCE(public.tb_chat_user_moderation_state.warning_count, 0) + 1,
             notes = COALESCE(EXCLUDED.notes, public.tb_chat_user_moderation_state.notes),
             updated_at = NOW()
       RETURNING *`,
      [id_user, String(minutes), notes || null]
    );
    return r.rows[0];
  }

  static async banUser(conn, id_user, minutes, notes) {
    const r = await conn.query(
      `INSERT INTO public.tb_chat_user_moderation_state
         (id_user, public_chat_banned_until, last_violation_at, notes)
       VALUES ($1, NOW() + ($2 || ' minutes')::interval, NOW(), $3)
       ON CONFLICT (id_user) DO UPDATE
         SET public_chat_banned_until = GREATEST(
               COALESCE(public.tb_chat_user_moderation_state.public_chat_banned_until, NOW()),
               EXCLUDED.public_chat_banned_until
             ),
             last_violation_at = NOW(),
             warning_count = COALESCE(public.tb_chat_user_moderation_state.warning_count, 0) + 1,
             notes = COALESCE(EXCLUDED.notes, public.tb_chat_user_moderation_state.notes),
             updated_at = NOW()
       RETURNING *`,
      [id_user, String(minutes), notes || null]
    );
    return r.rows[0];
  }

  static async clearUserPenalties(conn, id_user) {
    const r = await conn.query(
      `UPDATE public.tb_chat_user_moderation_state
          SET public_chat_muted_until = NULL,
              public_chat_banned_until = NULL,
              updated_at = NOW()
        WHERE id_user = $1
        RETURNING *`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  // ─── message hide / mask helpers ──────────────────────────────────────────
  static async hideMessage(conn, id_chat_message, reason) {
    const r = await conn.query(
      `UPDATE public.tb_chat_message
          SET hidden_at = NOW(), hidden_reason = $2
        WHERE id_chat_message = $1 AND hidden_at IS NULL
        RETURNING *`,
      [id_chat_message, reason || "reports"]
    );
    return r.rows[0] || null;
  }

  static async countReports(conn, id_chat_message) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS count FROM public.tb_chat_report WHERE id_chat_message = $1`,
      [id_chat_message]
    );
    return r.rows[0]?.count || 0;
  }

  static async getMessageById(conn, id_chat_message) {
    const r = await conn.query(
      `SELECT m.*, room.type AS room_type
         FROM public.tb_chat_message m
         JOIN public.tb_chat_room room ON room.id_chat_room = m.id_chat_room
        WHERE m.id_chat_message = $1`,
      [id_chat_message]
    );
    return r.rows[0] || null;
  }
}

module.exports = ChatModerationStorage;
