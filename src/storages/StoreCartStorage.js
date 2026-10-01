// src/storages/StoreCartStorage.js
// O carrinho da Loja (mig 271): um PAGAMENTO com N pedidos dentro.
//
// ⚠️ Os pedidos-filhos (`tb_profile_product_order.id_cart`) NÃO carregam a
// referência de pagamento — ela mora só aqui. Ver o cabeçalho da mig 271.

class StoreCartStorage {
  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_store_cart
         (id_seller_profile, id_seller_user, id_buyer_user, buyer_name, buyer_email,
          buyer_whatsapp, note, items_count, total_cents, id_community, return_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        data.id_seller_profile,
        data.id_seller_user,
        data.id_buyer_user || null,
        data.buyer_name,
        data.buyer_email,
        data.buyer_whatsapp,
        data.note || null,
        data.items_count,
        data.total_cents,
        data.id_community || null,
        data.return_url || null,
      ]
    );
    return r.rows[0];
  }

  /** Um filho por item. Nasce `pending`, sem referência de pagamento. */
  static async createOrder(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_product_order
         (id_buyer_user, id_profile_product, id_seller_profile, id_seller_user,
          quantity, unit_price_cents, shipping_cents, total_cents,
          seller_amount_cents, service_fee_cents, processor_fee_cents, processor_fee_source,
          delivery_mode, buyer_name, buyer_email, buyer_whatsapp, id_cart, status)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,'fallback','local_pickup',$11,$12,$13,$14,'pending')
       RETURNING *`,
      [
        data.id_buyer_user || null,
        data.id_profile_product,
        data.id_seller_profile,
        data.id_seller_user,
        data.quantity,
        data.unit_price_cents,
        data.total_cents,
        data.seller_amount_cents,
        data.service_fee_cents,
        data.processor_fee_cents,
        data.buyer_name,
        data.buyer_email,
        data.buyer_whatsapp,
        data.id_cart,
      ]
    );
    return r.rows[0];
  }

  static async attachCharge(conn, id_cart, { provider, session_id, provider_ref, checkout_url }) {
    const r = await conn.query(
      `UPDATE public.tb_store_cart
          SET provider = $2, session_id = $3, provider_ref = $4, checkout_url = $5, updated_at = NOW()
        WHERE id_cart = $1
        RETURNING *`,
      [id_cart, provider || null, session_id, provider_ref || session_id, checkout_url || null]
    );
    return r.rows[0] || null;
  }

  static async getById(conn, id_cart) {
    const r = await conn.query(`SELECT * FROM public.tb_store_cart WHERE id_cart = $1`, [id_cart]);
    return r.rows[0] || null;
  }

  static async lockById(conn, id_cart) {
    const r = await conn.query(
      `SELECT * FROM public.tb_store_cart WHERE id_cart = $1 FOR UPDATE`,
      [id_cart]
    );
    return r.rows[0] || null;
  }

  static async getBySession(conn, session_id) {
    const r = await conn.query(`SELECT * FROM public.tb_store_cart WHERE session_id = $1`, [session_id]);
    return r.rows[0] || null;
  }

  /**
   * O estorno chega com o id da COBRANÇA. No Mercado Pago ele é o `payment` que
   * a confirmação gravou; `provider_ref` cobre a ordem inversa (estorno lido
   * antes de a confirmação ter re-carimbado).
   */
  static async getByPaymentRef(conn, ref) {
    if (!ref) return null;
    const r = await conn.query(
      `SELECT * FROM public.tb_store_cart
        WHERE payment_intent_id = $1 OR charge_id = $1 OR provider_ref = $1
        LIMIT 1`,
      [String(ref)]
    );
    return r.rows[0] || null;
  }

  static async listOrders(conn, id_cart) {
    const r = await conn.query(
      `SELECT o.*, pp.name AS product_name,
              (SELECT media_url FROM public.tb_profile_product_media m
                WHERE m.id_profile_product = o.id_profile_product
                ORDER BY m.sort_order ASC, m.id_product_media ASC LIMIT 1) AS product_cover_url
         FROM public.tb_profile_product_order o
         JOIN public.tb_profile_product pp ON pp.id_profile_product = o.id_profile_product
        WHERE o.id_cart = $1
        ORDER BY o.id_order ASC`,
      [id_cart]
    );
    return r.rows;
  }

  static async markPaid(conn, id_cart, { payment_intent_id, charge_id }) {
    const r = await conn.query(
      `UPDATE public.tb_store_cart
          SET status = 'paid', paid_at = NOW(),
              payment_intent_id = COALESCE($2, payment_intent_id),
              charge_id = COALESCE($3, charge_id),
              provider_ref = COALESCE($2, provider_ref),
              updated_at = NOW()
        WHERE id_cart = $1 AND status = 'pending'
        RETURNING *`,
      [id_cart, payment_intent_id || null, charge_id || null]
    );
    return r.rows[0] || null;
  }

  /** Filho pago — sem referência de pagamento, de propósito (mig 271). */
  static async markOrderPaid(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_profile_product_order
          SET status = 'paid', paid_at = NOW(), updated_at = NOW()
        WHERE id_order = $1 AND status = 'pending'
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async markCanceled(conn, id_cart, { payment_intent_id = null, charge_id = null } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_store_cart
          SET status = 'canceled', canceled_at = NOW(),
              payment_intent_id = COALESCE($2, payment_intent_id),
              charge_id = COALESCE($3, charge_id),
              provider_ref = COALESCE($2, provider_ref),
              updated_at = NOW()
        WHERE id_cart = $1 AND status = 'pending'
        RETURNING *`,
      [id_cart, payment_intent_id, charge_id]
    );
    await conn.query(
      `UPDATE public.tb_profile_product_order
          SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
        WHERE id_cart = $1 AND status = 'pending'`,
      [id_cart]
    );
    return r.rows[0] || null;
  }

  static async markRefunded(conn, id_cart) {
    await conn.query(
      `UPDATE public.tb_profile_product_order
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id_cart = $1 AND status IN ('paid','shipped','delivered')`,
      [id_cart]
    );
    const r = await conn.query(
      `UPDATE public.tb_store_cart
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id_cart = $1
        RETURNING *`,
      [id_cart]
    );
    return r.rows[0] || null;
  }
}

module.exports = StoreCartStorage;
