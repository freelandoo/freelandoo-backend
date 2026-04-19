class OrderStorage {
  /**
   * 📌 Busca uma order por ID
   */
  static async getOrderById(pool, id_order) {
    const query = `
            SELECT *
            FROM tb_order
            WHERE id_order = $1
              AND is_active = true
            LIMIT 1
        `;

    const { rows } = await pool.query(query, [id_order]);
    return rows[0] || null;
  }

  /**
   * 📌 Lista orders do usuário
   *
   * Filtro opcional:
   * - status
   */
  static async listOrdersByUser(pool, data) {
    const { id_user, status } = data;

    const values = [id_user];
    let whereExtra = "";

    if (status) {
      values.push(status);
      whereExtra += ` AND status = $${values.length}`;
    }

    const query = `
            SELECT *
            FROM tb_order
            WHERE id_user = $1
              AND is_active = true
              ${whereExtra}
            ORDER BY created_at DESC
        `;

    const { rows } = await pool.query(query, values);
    return rows;
  }

  /**
   * 📌 Lista os itens de uma order
   */
  static async listOrderItems(pool, id_order) {
    const query = `
            SELECT
                oi.*,
                i.desc_item AS current_item_name,
                i.unity_price_cents AS current_price_cents,
                i.is_active AS item_is_active
            FROM tb_order_item oi
            LEFT JOIN tb_item i
                ON i.id_item = oi.id_item
            WHERE oi.id_order = $1
              AND oi.is_active = true
            ORDER BY oi.created_at ASC
        `;

    const { rows } = await pool.query(query, [id_order]);
    return rows;
  }

  /**
   * 📌 Busca o cupom aplicado na order
   */
  static async getOrderCouponByOrderId(pool, id_order) {
    const query = `
            SELECT
                oc.*,
                c.code,
                c.discount_type,
                c.scope,
                c.apply_mode,
                c.max_discount_cents,
                c.min_order_cents,
                c.value,
                c.owner_user_id,
                c.max_uses,
                c.applies_to_item_id,
                c.expires_at AS coupon_expires_at,
                c.is_active AS coupon_is_active
            FROM tb_order_coupon oc
            LEFT JOIN tb_coupon c
                ON c.id_coupon = oc.id_coupon
            WHERE oc.id_order = $1
              AND oc.is_active = true
            ORDER BY oc.created_at DESC
            LIMIT 1
        `;

    const { rows } = await pool.query(query, [id_order]);
    return rows[0] || null;
  }

  /**
   * 📌 Monta o resumo completo da order
   *
   * Retorna:
   * - dados da order
   * - items
   * - coupon
   */
  static async getOrderSummary(pool, id_order) {
    const order = await this.getOrderById(pool, id_order);

    if (!order) {
      return null;
    }

    const items = await this.listOrderItems(pool, id_order);
    const coupon = await this.getOrderCouponByOrderId(pool, id_order);

    return {
      ...order,
      items,
      coupon,
    };
  }

  /**
   * 📌 Cancela uma order
   */
  static async cancelOrder(pool, id_order) {
    const query = `
            UPDATE tb_order
            SET
                status = 'CANCELED',
                updated_at = NOW()
            WHERE id_order = $1
            RETURNING *
        `;

    const { rows } = await pool.query(query, [id_order]);
    return rows[0] || null;
  }
}

module.exports = OrderStorage;
