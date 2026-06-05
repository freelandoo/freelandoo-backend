/**
 * ProtectionStorage — caso de proteção (tb_protection_case) + provas de
 * fulfillment (tb_fulfillment_proof). Âncora domain-aware via (domain, ref_id),
 * domain ∈ ('product','booking'), ref_id = id_order / id_booking.
 */

const DOMAINS = new Set(["product", "booking"]);
const PROOF_KINDS = new Set(["shipment", "arrival", "completion"]);

class ProtectionStorage {
  /** Cria (ou recupera) o caso em awaiting_fulfillment. Idempotente. */
  static async openCase(conn, { domain, ref_id }) {
    await conn.query(
      `INSERT INTO public.tb_protection_case (domain, ref_id, state)
       VALUES ($1, $2, 'awaiting_fulfillment')
       ON CONFLICT (domain, ref_id) DO NOTHING`,
      [domain, ref_id]
    );
    return ProtectionStorage.getCase(conn, { domain, ref_id });
  }

  static async getCase(conn, { domain, ref_id }) {
    const r = await conn.query(
      `SELECT * FROM public.tb_protection_case WHERE domain = $1 AND ref_id = $2 LIMIT 1`,
      [domain, ref_id]
    );
    return r.rows[0] || null;
  }

  static async getCaseById(conn, id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_protection_case WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  }

  static async recordProof(conn, { protection_case_id, kind, photo_url, tracking_code, created_by_user_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_fulfillment_proof
         (protection_case_id, kind, photo_url, tracking_code, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [protection_case_id, kind, photo_url || null, tracking_code || null, created_by_user_id || null]
    );
    return r.rows[0];
  }

  static async listProofs(conn, protection_case_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_fulfillment_proof
        WHERE protection_case_id = $1 ORDER BY created_at`,
      [protection_case_id]
    );
    return r.rows;
  }

  static async hasProof(conn, protection_case_id, kind) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_fulfillment_proof
        WHERE protection_case_id = $1 AND kind = $2 LIMIT 1`,
      [protection_case_id, kind]
    );
    return !!r.rows[0];
  }

  /** Marca a confirmação do cliente (serviço). Idempotente. */
  static async setClientConfirmed(conn, id) {
    const r = await conn.query(
      `UPDATE public.tb_protection_case
          SET client_confirmed_at = COALESCE(client_confirmed_at, NOW()), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return r.rows[0] || null;
  }

  /**
   * Inicia a janela de disputa (proof_at = NOW, window_ends_at = NOW + windowDays).
   * Só age se ainda estiver em awaiting_fulfillment (idempotente).
   */
  static async startWindow(conn, id, windowDays) {
    const r = await conn.query(
      `UPDATE public.tb_protection_case
          SET state = 'dispute_window',
              proof_at = NOW(),
              window_ends_at = NOW() + ($2 || ' days')::interval,
              updated_at = NOW()
        WHERE id = $1 AND state = 'awaiting_fulfillment'
        RETURNING *`,
      [id, String(windowDays)]
    );
    return r.rows[0] || null;
  }

  /**
   * CDC: cases cuja janela venceu sem disputa → clear. Usa SKIP LOCKED pra não
   * colidir com execuções concorrentes do job.
   */
  static async clearDueWindows(conn, limit = 50) {
    const r = await conn.query(
      `UPDATE public.tb_protection_case c
          SET state = 'clear', cleared_at = NOW(), updated_at = NOW()
        WHERE c.id IN (
          SELECT id FROM public.tb_protection_case
           WHERE state = 'dispute_window'
             AND window_ends_at <= NOW()
             AND current_dispute_id IS NULL
           ORDER BY window_ends_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        )
        RETURNING c.id, c.domain, c.ref_id, c.cleared_at`,
      [limit]
    );
    return r.rows;
  }

  /** Marca disputado e fixa o dispute corrente (congela liberação). */
  static async markDisputed(conn, id, dispute_id) {
    const r = await conn.query(
      `UPDATE public.tb_protection_case
          SET state = 'disputed', current_dispute_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, dispute_id]
    );
    return r.rows[0] || null;
  }

  /** Resolução pró-comprador: caso vira refunded. */
  static async markRefunded(conn, id) {
    const r = await conn.query(
      `UPDATE public.tb_protection_case
          SET state = 'refunded', current_dispute_id = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return r.rows[0] || null;
  }

  /** Resolução pró-vendedor: caso volta a clear e arma o ledger. */
  static async markClearFromDispute(conn, id) {
    const r = await conn.query(
      `UPDATE public.tb_protection_case
          SET state = 'clear', cleared_at = COALESCE(cleared_at, NOW()),
              current_dispute_id = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return r.rows[0] || null;
  }
}

ProtectionStorage.DOMAINS = DOMAINS;
ProtectionStorage.PROOF_KINDS = PROOF_KINDS;

module.exports = ProtectionStorage;
