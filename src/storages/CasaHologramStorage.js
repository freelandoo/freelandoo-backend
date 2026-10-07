// src/storages/CasaHologramStorage.js
// Compras de hologramas da Casa Views (mig 274). SQL puro; a regra mora no
// CasaHologramService.

class CasaHologramStorage {
  /** Hologramas da vitrine: um por personagem, a primeira compra paga e não estornada. */
  static async listOwned(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT hologram_key, MIN(paid_at) AS collected_at
         FROM public.tb_casa_hologram_purchase
        WHERE id_user = $1 AND status = 'paid' AND refunded_at IS NULL
        GROUP BY hologram_key
        ORDER BY MIN(paid_at)`,
      [id_user]
    );
    return rows;
  }

  static async isOwned(conn, id_user, hologram_key) {
    const { rows } = await conn.query(
      `SELECT 1 FROM public.tb_casa_hologram_purchase
        WHERE id_user = $1 AND hologram_key = $2
          AND status = 'paid' AND refunded_at IS NULL
        LIMIT 1`,
      [id_user, hologram_key]
    );
    return rows.length > 0;
  }

  /** Administrador (papel `Administrator`, a mesma régua do selo verificado). */
  static async isAdmin(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT 1 FROM public.tb_user_role ur
         JOIN public.tb_role r ON r.id_role = ur.id_role
        WHERE ur.id_user = $1 AND ur.is_active = TRUE AND r.is_active = TRUE
          AND r.desc_role = 'Administrator'
        LIMIT 1`,
      [id_user]
    );
    return rows.length > 0;
  }

  /** Coleta de cortesia (admin): nasce paga, a R$0, sem passar pelo gateway. */
  static async createFreePurchase(conn, { id_user, hologram_key, session_ref }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_casa_hologram_purchase
         (id_user, hologram_key, amount_cents, status, stripe_session_id, paid_at)
       VALUES ($1, $2, 0, 'paid', $3, NOW())
       RETURNING *`,
      [id_user, hologram_key, session_ref]
    );
    return rows[0];
  }

  static async createPurchase(conn, { id_user, hologram_key, amount_cents, stripe_session_id }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_casa_hologram_purchase
         (id_user, hologram_key, amount_cents, stripe_session_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id_user, hologram_key, amount_cents, stripe_session_id]
    );
    return rows[0];
  }

  static async getBySession(conn, stripe_session_id, { forUpdate = false } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_casa_hologram_purchase
        WHERE stripe_session_id = $1
        LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [stripe_session_id]
    );
    return rows[0] || null;
  }

  static async getByPaymentIntent(conn, ref) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_casa_hologram_purchase
        WHERE stripe_payment_intent = $1
        LIMIT 1`,
      [ref]
    );
    return rows[0] || null;
  }

  static async markPaid(conn, id, { stripe_payment_intent }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_casa_hologram_purchase
          SET status = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              stripe_payment_intent = COALESCE($2, stripe_payment_intent),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, stripe_payment_intent || null]
    );
    return rows[0] || null;
  }

  static async markExpiredBySession(conn, stripe_session_id) {
    const { rowCount } = await conn.query(
      `UPDATE public.tb_casa_hologram_purchase
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'`,
      [stripe_session_id]
    );
    return rowCount > 0;
  }

  /** Admin tira da própria vitrine (mig 275): as compras pagas daquele personagem viram `removed`. */
  static async markRemoved(conn, id_user, hologram_key) {
    const { rowCount } = await conn.query(
      `UPDATE public.tb_casa_hologram_purchase
          SET status = 'removed', updated_at = NOW()
        WHERE id_user = $1 AND hologram_key = $2
          AND status = 'paid' AND refunded_at IS NULL`,
      [id_user, hologram_key]
    );
    return rowCount;
  }

  static async markRefunded(conn, id) {
    await conn.query(
      `UPDATE public.tb_casa_hologram_purchase
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND refunded_at IS NULL`,
      [id]
    );
  }
}

module.exports = CasaHologramStorage;
