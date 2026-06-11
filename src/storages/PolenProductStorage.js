class PolenProductStorage {
  // ---------- Products ----------

  static async listProducts(conn, { onlyActive = false } = {}) {
    const where = onlyActive ? "WHERE is_active = TRUE" : "";
    const { rows } = await conn.query(
      `SELECT *
         FROM public.polen_products
         ${where}
         ORDER BY sort_order ASC, polens_amount ASC, name ASC`
    );
    return rows;
  }

  static async getProductById(conn, id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.polen_products WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async createProduct(conn, data) {
    const {
      name,
      description = null,
      image_url = null,
      price_cents,
      polens_amount,
      bonus_polens = 0,
      is_active = true,
      sort_order = 0,
    } = data;
    const { rows } = await conn.query(
      `INSERT INTO public.polen_products
         (name, description, image_url, price_cents, polens_amount, bonus_polens, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [name, description, image_url, price_cents, polens_amount, bonus_polens, is_active, sort_order]
    );
    return rows[0];
  }

  static async updateProduct(conn, id, patch) {
    const allowed = [
      "name",
      "description",
      "image_url",
      "price_cents",
      "polens_amount",
      "bonus_polens",
      "is_active",
      "sort_order",
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
    if (!fields.length) return this.getProductById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.polen_products SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async deleteProduct(conn, id) {
    // Soft-delete via is_active=false (referenciado por polen_purchases).
    const { rows } = await conn.query(
      `UPDATE public.polen_products
          SET is_active = FALSE,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  // ---------- Purchases ----------

  static async createPurchase(conn, data) {
    const { rows } = await conn.query(
      `INSERT INTO public.polen_purchases
         (user_id, product_id, status, amount_cents, stripe_session_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        data.user_id,
        data.product_id,
        data.status || "pending",
        data.amount_cents,
        data.stripe_session_id || null,
      ]
    );
    return rows[0];
  }

  static async getPurchaseByStripeSession(conn, sessionId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.polen_purchases WHERE stripe_session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return rows[0] || null;
  }

  static async getPurchaseByPaymentIntent(conn, paymentIntentId) {
    if (!paymentIntentId) return null;
    const { rows } = await conn.query(
      `SELECT * FROM public.polen_purchases WHERE stripe_payment_intent = $1 LIMIT 1`,
      [paymentIntentId]
    );
    return rows[0] || null;
  }

  static async markPurchasePaid(conn, id, { polens_credited, stripe_payment_intent }) {
    const { rows } = await conn.query(
      `UPDATE public.polen_purchases
          SET status = 'paid',
              polens_credited = $2,
              stripe_payment_intent = COALESCE($3, stripe_payment_intent),
              paid_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, polens_credited, stripe_payment_intent || null]
    );
    return rows[0] || null;
  }

  static async markPurchaseRefunded(conn, id) {
    const { rows } = await conn.query(
      `UPDATE public.polen_purchases
          SET status = 'refunded',
              refunded_at = COALESCE(refunded_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async markPurchaseExpiredBySession(conn, sessionId) {
    const { rows } = await conn.query(
      `UPDATE public.polen_purchases
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING *`,
      [sessionId]
    );
    return rows[0] || null;
  }

  static async listPurchasesForUser(conn, userId, { limit = 30, offset = 0 } = {}) {
    const { rows } = await conn.query(
      `SELECT pp.*, p.name AS product_name, p.image_url AS product_image_url
         FROM public.polen_purchases pp
         JOIN public.polen_products p ON p.id = pp.product_id
        WHERE pp.user_id = $1
        ORDER BY pp.created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  }
}

module.exports = PolenProductStorage;
