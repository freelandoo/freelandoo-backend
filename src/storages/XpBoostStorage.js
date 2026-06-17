// src/storages/XpBoostStorage.js
// Compras do booster de XP (nível 5). Espelha PolenProductStorage (dedupe por
// stripe_session_id UNIQUE).
module.exports = {
  async createPurchase(db, { user_id, id_profile, target_level, amount_cents, stripe_session_id }) {
    const r = await db.query(
      `INSERT INTO public.xp_boost_purchases
         (user_id, id_profile, target_level, status, amount_cents, stripe_session_id)
       VALUES ($1, $2, $3, 'pending', $4, $5)
       ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [user_id, id_profile, target_level, amount_cents, stripe_session_id || null]
    );
    if (r.rowCount) return r.rows[0];
    // Conflito (sessão já existe): devolve a linha existente.
    return this.getByStripeSession(db, stripe_session_id);
  },

  async getByStripeSession(db, stripe_session_id) {
    if (!stripe_session_id) return null;
    const r = await db.query(
      `SELECT * FROM public.xp_boost_purchases WHERE stripe_session_id = $1 LIMIT 1`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async getByPaymentIntent(db, payment_intent) {
    if (!payment_intent) return null;
    const r = await db.query(
      `SELECT * FROM public.xp_boost_purchases WHERE stripe_payment_intent = $1 LIMIT 1`,
      [payment_intent]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async markPaid(db, id, { xp_granted, stripe_payment_intent }) {
    const r = await db.query(
      `UPDATE public.xp_boost_purchases
          SET status = 'paid', xp_granted = $2, stripe_payment_intent = $3,
              paid_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, xp_granted, stripe_payment_intent || null]
    );
    return r.rows[0];
  },

  async markExpiredBySession(db, stripe_session_id) {
    const r = await db.query(
      `UPDATE public.xp_boost_purchases
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id`,
      [stripe_session_id]
    );
    return r.rowCount > 0;
  },

  async markRefunded(db, id) {
    const r = await db.query(
      `UPDATE public.xp_boost_purchases
          SET refunded_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return r.rows[0];
  },
};
