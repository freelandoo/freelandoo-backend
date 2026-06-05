/**
 * ReturnStorage — devoluções/logística reversa (tb_return). 1:1 com a disputa.
 */
class ReturnStorage {
  static async create(conn, { dispute_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_return (dispute_id, reverse_status)
       VALUES ($1, 'pending')
       ON CONFLICT (dispute_id) DO NOTHING
       RETURNING *`,
      [dispute_id]
    );
    if (r.rows[0]) return r.rows[0];
    return ReturnStorage.getByDispute(conn, dispute_id);
  }

  static async getByDispute(conn, dispute_id) {
    const r = await conn.query(`SELECT * FROM public.tb_return WHERE dispute_id = $1 LIMIT 1`, [dispute_id]);
    return r.rows[0] || null;
  }

  static async getById(conn, id) {
    const r = await conn.query(`SELECT * FROM public.tb_return WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  }

  static async markPurchased(conn, id, { me_reverse_order_id, reverse_tracking_code, reverse_auth_code, reverse_label_url }) {
    const r = await conn.query(
      `UPDATE public.tb_return
          SET me_reverse_order_id = $2,
              reverse_tracking_code = $3,
              reverse_auth_code = $4,
              reverse_label_url = $5,
              reverse_status = 'code_issued',
              purchased_at = NOW(),
              error = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, me_reverse_order_id || null, reverse_tracking_code || null, reverse_auth_code || null, reverse_label_url || null]
    );
    return r.rows[0] || null;
  }

  static async markFailure(conn, id, error_message) {
    const r = await conn.query(
      `UPDATE public.tb_return
          SET error = $2,
              reverse_status = CASE WHEN reverse_status = 'pending' THEN 'error' ELSE reverse_status END,
              attempts = attempts + 1,
              last_attempt_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, String(error_message || "").slice(0, 400)]
    );
    return r.rows[0] || null;
  }

  static async updateStatus(conn, id, status, { tracking_code, posted, delivered } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_return
          SET reverse_status = $2,
              reverse_tracking_code = COALESCE($3, reverse_tracking_code),
              posted_at = CASE WHEN $4 THEN COALESCE(posted_at, NOW()) ELSE posted_at END,
              delivered_at = CASE WHEN $5 THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, status, tracking_code || null, !!posted, !!delivered]
    );
    return r.rows[0] || null;
  }

  static async listPendingPurchase(conn, { limit = 20 } = {}) {
    const r = await conn.query(
      `SELECT id FROM public.tb_return
        WHERE reverse_status IN ('pending','error')
          AND attempts < 5
          AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '30 minutes')
        ORDER BY created_at ASC
        LIMIT $1`,
      [limit]
    );
    return r.rows.map((x) => x.id);
  }

  static async listTrackable(conn, { limit = 50 } = {}) {
    const r = await conn.query(
      `SELECT id, me_reverse_order_id FROM public.tb_return
        WHERE reverse_status IN ('code_issued','posted','in_transit')
          AND me_reverse_order_id IS NOT NULL
        ORDER BY updated_at ASC
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }
}

module.exports = ReturnStorage;
