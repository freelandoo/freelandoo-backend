/**
 * DisputeStorage — disputas (tb_dispute) + evidências (tb_dispute_evidence).
 */
const REASON_CODES = new Set([
  "product_not_arrived", "product_wrong", "product_defective",
  "service_no_show", "scam", "other",
]);

class DisputeStorage {
  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_dispute
         (protection_case_id, domain, ref_id, opened_by_user_id, reason_code, state, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        data.protection_case_id, data.domain, data.ref_id,
        data.opened_by_user_id || null, data.reason_code,
        data.state || "open", data.description || null,
      ]
    );
    return r.rows[0];
  }

  static async getById(conn, id) {
    const r = await conn.query(`SELECT * FROM public.tb_dispute WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  }

  /** Disputa ativa (não resolvida) de um caso — evita duplicar. */
  static async getActiveByCase(conn, protection_case_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_dispute
        WHERE protection_case_id = $1
          AND state NOT IN ('resolved_refund','resolved_release')
        ORDER BY created_at DESC LIMIT 1`,
      [protection_case_id]
    );
    return r.rows[0] || null;
  }

  static async updateState(conn, id, state, { resolved_by, resolution_note } = {}) {
    const resolving = state === "resolved_refund" || state === "resolved_release";
    const r = await conn.query(
      `UPDATE public.tb_dispute
          SET state = $2,
              resolved_by = COALESCE($3, resolved_by),
              resolution_note = COALESCE($4, resolution_note),
              resolved_at = CASE WHEN $5 THEN NOW() ELSE resolved_at END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, state, resolved_by || null, resolution_note || null, resolving]
    );
    return r.rows[0] || null;
  }

  static async addEvidence(conn, { dispute_id, uploaded_by_user_id, role, photo_url, note }) {
    const r = await conn.query(
      `INSERT INTO public.tb_dispute_evidence
         (dispute_id, uploaded_by_user_id, role, photo_url, note)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [dispute_id, uploaded_by_user_id || null, role, photo_url || null, note || null]
    );
    return r.rows[0];
  }

  static async listEvidence(conn, dispute_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_dispute_evidence WHERE dispute_id = $1 ORDER BY created_at`,
      [dispute_id]
    );
    return r.rows;
  }

  static async listAdmin(conn, { state, domain, q, limit = 50, offset = 0 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (state) { params.push(state); where.push(`d.state = $${params.length}`); }
    if (domain) { params.push(domain); where.push(`d.domain = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(d.description ILIKE $${params.length} OR d.reason_code ILIKE $${params.length})`); }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT d.*,
              c.state AS case_state,
              u.username AS buyer_username,
              u.email    AS buyer_email
         FROM public.tb_dispute d
         JOIN public.tb_protection_case c ON c.id = d.protection_case_id
         LEFT JOIN public.tb_user u ON u.id_user = d.opened_by_user_id
         WHERE ${where.join(" AND ")}
         ORDER BY
           CASE WHEN d.state = 'escalated_admin' THEN 0 ELSE 1 END,
           d.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  /** Disputas "não chegou" escaladas e antigas (p/ checagem do rastreio de ida). */
  static async listStaleNotArrived(conn, { days = 10, limit = 30 } = {}) {
    const r = await conn.query(
      `SELECT * FROM public.tb_dispute
        WHERE domain = 'product'
          AND reason_code = 'product_not_arrived'
          AND state = 'escalated_admin'
          AND created_at < NOW() - ($1 || ' days')::interval
        ORDER BY created_at ASC
        LIMIT $2`,
      [String(days), limit]
    );
    return r.rows;
  }

  static async countByState(conn) {
    const r = await conn.query(
      `SELECT state, COUNT(*)::int AS c FROM public.tb_dispute GROUP BY state`
    );
    return r.rows;
  }
}

DisputeStorage.REASON_CODES = REASON_CODES;

module.exports = DisputeStorage;
