class ProfileSubscriptionStorage {
  static async create(conn, data) {
    const {
      id_user,
      id_profile = null,
      status = "pending",
      amount_cents,
      currency = "BRL",
      stripe_customer_id = null,
      stripe_checkout_session_id = null,
      stripe_price_id = null,
      stripe_promotion_code = null,
      id_coupon = null,
    } = data;

    const { rows } = await conn.query(
      `INSERT INTO public.tb_profile_subscription
         (id_user, id_profile, status, amount_cents, currency,
          stripe_customer_id, stripe_checkout_session_id, stripe_price_id,
          stripe_promotion_code, id_coupon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id_user,
        id_profile,
        status,
        amount_cents,
        currency,
        stripe_customer_id,
        stripe_checkout_session_id,
        stripe_price_id,
        stripe_promotion_code,
        id_coupon,
      ]
    );
    return rows[0];
  }

  static async findBySessionId(conn, sessionId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_profile_subscription
       WHERE stripe_checkout_session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return rows[0] || null;
  }

  static async findBySubscriptionId(conn, subscriptionId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_profile_subscription
       WHERE stripe_subscription_id = $1 LIMIT 1`,
      [subscriptionId]
    );
    return rows[0] || null;
  }

  static async findByCustomerId(conn, customerId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_profile_subscription
       WHERE stripe_customer_id = $1
       ORDER BY created_at DESC`,
      [customerId]
    );
    return rows;
  }

  static async findLatestActiveByUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_profile_subscription
       WHERE id_user = $1
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'past_due' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT 1`,
      [id_user]
    );
    return rows[0] || null;
  }

  static async findActiveByProfile(conn, id_profile) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_profile_subscription
       WHERE id_profile = $1
         AND status IN ('active','past_due','pending')
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'past_due' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT 1`,
      [id_profile]
    );
    return rows[0] || null;
  }

  static async listByUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_profile_subscription
       WHERE id_user = $1
       ORDER BY created_at DESC`,
      [id_user]
    );
    return rows;
  }

  static async updateBySessionId(conn, sessionId, patch) {
    const fields = [];
    const values = [sessionId];
    let i = 2;
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (!fields.length) return null;
    fields.push(`updated_at = NOW()`);
    const { rows } = await conn.query(
      `UPDATE public.tb_profile_subscription
       SET ${fields.join(", ")}
       WHERE stripe_checkout_session_id = $1
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async updateBySubscriptionId(conn, subscriptionId, patch) {
    const fields = [];
    const values = [subscriptionId];
    let i = 2;
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (!fields.length) return null;
    fields.push(`updated_at = NOW()`);
    const { rows } = await conn.query(
      `UPDATE public.tb_profile_subscription
       SET ${fields.join(", ")}
       WHERE stripe_subscription_id = $1
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }
}

module.exports = ProfileSubscriptionStorage;
