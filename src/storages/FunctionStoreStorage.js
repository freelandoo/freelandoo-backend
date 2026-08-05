// src/storages/FunctionStoreStorage.js
// Loja de Funções (mig 191): catálogo fechado (1 linha por feature_key da
// whitelist) + compras vitalícias por usuário. Dedupe por stripe_session_id
// UNIQUE parcial, espelhando XpBoostStorage.
module.exports = {
  /* ------------------------------ catálogo ------------------------------ */

  async listProducts(db, { onlyForSale = false } = {}) {
    const r = await db.query(
      `SELECT *
         FROM public.tb_function_product
        ${onlyForSale ? "WHERE is_for_sale = TRUE" : ""}
        ORDER BY sort_order ASC, nav_label ASC`
    );
    return r.rows;
  },

  async getProductByKey(db, feature_key) {
    const r = await db.query(
      `SELECT * FROM public.tb_function_product WHERE feature_key = $1 LIMIT 1`,
      [feature_key]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async getProductById(db, id) {
    const r = await db.query(
      `SELECT * FROM public.tb_function_product WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  // Catálogo fechado: só UPDATE (não existe criar/excluir produto de função —
  // função nova = código novo + linha nova no seed da migration).
  async updateProduct(db, id, fields) {
    const allowed = [
      "nav_label",
      "eyebrow",
      "headline",
      "short_description",
      "full_description",
      "background_color",
      "accent_color",
      "text_color",
      "placeholder_color",
      "image_url",
      "price_cents",
      // NULL/0 = função não vendida por Poléns (mig 195).
      "price_polens",
      "is_for_sale",
      "sort_order",
    ];
    const sets = [];
    const vals = [id];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        vals.push(fields[key]);
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (!sets.length) return this.getProductById(db, id);
    const r = await db.query(
      `UPDATE public.tb_function_product
          SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      vals
    );
    return r.rowCount ? r.rows[0] : null;
  },

  /* ------------------------------ compras ------------------------------- */

  async createPurchase(db, { id_user, feature_key, id_product, amount_cents, amount_polens = 0, stripe_session_id, payment_provider = "stripe", status = "pending" }) {
    const r = await db.query(
      `INSERT INTO public.tb_user_function_purchase
         (id_user, feature_key, id_product, status, amount_cents, amount_polens, payment_provider, stripe_session_id, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $4 = 'paid' THEN NOW() ELSE NULL END)
       ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [id_user, feature_key, id_product || null, status, amount_cents, amount_polens || 0, payment_provider, stripe_session_id || null]
    );
    if (r.rowCount) return r.rows[0];
    return this.getByStripeSession(db, stripe_session_id);
  },

  async getByStripeSession(db, stripe_session_id) {
    if (!stripe_session_id) return null;
    const r = await db.query(
      `SELECT * FROM public.tb_user_function_purchase WHERE stripe_session_id = $1 LIMIT 1`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async getByPaymentIntent(db, payment_intent) {
    if (!payment_intent) return null;
    const r = await db.query(
      `SELECT * FROM public.tb_user_function_purchase WHERE stripe_payment_intent = $1 LIMIT 1`,
      [payment_intent]
    );
    return r.rowCount ? r.rows[0] : null;
  },

  async markPaid(db, id, { stripe_payment_intent } = {}) {
    const r = await db.query(
      `UPDATE public.tb_user_function_purchase
          SET status = 'paid', stripe_payment_intent = COALESCE($2, stripe_payment_intent),
              paid_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, stripe_payment_intent || null]
    );
    return r.rows[0];
  },

  async markExpiredBySession(db, stripe_session_id) {
    const r = await db.query(
      `UPDATE public.tb_user_function_purchase
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id`,
      [stripe_session_id]
    );
    return r.rowCount > 0;
  },

  async markRefunded(db, id) {
    const r = await db.query(
      `UPDATE public.tb_user_function_purchase
          SET refunded_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return r.rows[0];
  },

  // Revogação manual (admin): marca refunded_at na compra paga viva da função.
  async revokeOwnership(db, id_user, feature_key) {
    const r = await db.query(
      `UPDATE public.tb_user_function_purchase
          SET refunded_at = NOW(), updated_at = NOW()
        WHERE id_user = $1 AND feature_key = $2
          AND status = 'paid' AND refunded_at IS NULL
        RETURNING id`,
      [id_user, feature_key]
    );
    return r.rowCount > 0;
  },

  // Dono = tem compra paga sem reembolso para a chave.
  async userOwnsFunction(db, id_user, feature_key) {
    const r = await db.query(
      `SELECT 1
         FROM public.tb_user_function_purchase
        WHERE id_user = $1 AND feature_key = $2
          AND status = 'paid' AND refunded_at IS NULL
        LIMIT 1`,
      [id_user, feature_key]
    );
    return r.rowCount > 0;
  },

  // Chaves que o usuário possui (compra paga viva) — uma ida ao banco.
  async listOwnedKeys(db, id_user) {
    const r = await db.query(
      `SELECT DISTINCT feature_key
         FROM public.tb_user_function_purchase
        WHERE id_user = $1 AND status = 'paid' AND refunded_at IS NULL`,
      [id_user]
    );
    return r.rows.map((row) => row.feature_key);
  },

  /* ------------------------------- admin -------------------------------- */

  async listPurchases(db, { page = 1, per_page = 50, feature_key = null } = {}) {
    const offset = (Math.max(1, page) - 1) * per_page;
    const vals = [per_page, offset];
    let where = "";
    if (feature_key) {
      vals.push(feature_key);
      where = `WHERE p.feature_key = $3`;
    }
    const r = await db.query(
      `SELECT p.*, u.username, u.email
         FROM public.tb_user_function_purchase p
         JOIN public.tb_user u ON u.id_user = p.id_user
        ${where}
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2`,
      vals
    );
    return r.rows;
  },

  async purchaseStats(db) {
    const r = await db.query(
      `SELECT feature_key,
              COUNT(*) FILTER (WHERE status = 'paid' AND refunded_at IS NULL)::int AS owners,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid' AND refunded_at IS NULL), 0)::bigint AS revenue_cents,
              COALESCE(SUM(amount_polens) FILTER (WHERE status = 'paid' AND refunded_at IS NULL), 0)::bigint AS revenue_polens
         FROM public.tb_user_function_purchase
        GROUP BY feature_key`
    );
    return r.rows;
  },
};
