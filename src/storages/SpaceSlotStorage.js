// src/storages/SpaceSlotStorage.js
// Vagas pagas de pet e carro (mig 264). SQL puro; a regra mora no
// SpaceSlotService.

const SLOT_KINDS = ["pet", "car"];

class SpaceSlotStorage {
  static get KINDS() {
    return SLOT_KINDS;
  }

  /** Espaços VIVOS daquela modalidade que a pessoa lidera. */
  static async countLiveSpaces(conn, id_user, kind) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_profile
        WHERE id_leader_user = $1
          AND is_community = TRUE
          AND community_kind = $2
          AND deleted_at IS NULL`,
      [id_user, kind]
    );
    return rows[0]?.n || 0;
  }

  /** Vagas pagas e não estornadas. */
  static async countPaidSlots(conn, id_user, kind) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_space_slot_purchase
        WHERE id_user = $1 AND kind = $2
          AND status = 'paid' AND refunded_at IS NULL`,
      [id_user, kind]
    );
    return rows[0]?.n || 0;
  }

  /**
   * Serializa as criações de UMA pessoa numa modalidade dentro da transação de
   * quem chamou. Sem isso, dois cliques simultâneos leriam a mesma contagem e
   * os dois passariam pelo limite.
   */
  static async lockUserKind(client, id_user, kind) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `space-slot:${id_user}:${kind}`,
    ]);
  }

  static async createPurchase(conn, { id_user, kind, amount_cents, stripe_session_id }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_space_slot_purchase
         (id_user, kind, amount_cents, stripe_session_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id_user, kind, amount_cents, stripe_session_id]
    );
    return rows[0];
  }

  static async getBySession(conn, stripe_session_id, { forUpdate = false } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_space_slot_purchase
        WHERE stripe_session_id = $1
        LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [stripe_session_id]
    );
    return rows[0] || null;
  }

  static async getByPaymentIntent(conn, ref) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_space_slot_purchase
        WHERE stripe_payment_intent = $1
        LIMIT 1`,
      [ref]
    );
    return rows[0] || null;
  }

  static async markPaid(conn, id, { stripe_payment_intent, id_profile }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_space_slot_purchase
          SET status = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              stripe_payment_intent = COALESCE($2, stripe_payment_intent),
              id_profile = COALESCE($3, id_profile),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, stripe_payment_intent || null, id_profile || null]
    );
    return rows[0] || null;
  }

  static async markExpiredBySession(conn, stripe_session_id) {
    const { rowCount } = await conn.query(
      `UPDATE public.tb_space_slot_purchase
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'`,
      [stripe_session_id]
    );
    return rowCount > 0;
  }

  static async markRefunded(conn, id) {
    await conn.query(
      `UPDATE public.tb_space_slot_purchase
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND refunded_at IS NULL`,
      [id]
    );
  }
}

module.exports = SpaceSlotStorage;
