const AffiliateConversionService = require("../services/AffiliateConversionService");

class CheckoutStorage {
  static async getItemById(pool, id_item) {
    const query = `
        SELECT
            id_item,
            desc_item,
            details,
            unity_price_cents,
            currency,
            is_active
        FROM tb_item
        WHERE id_item = $1
        LIMIT 1
    `;

    const { rows } = await pool.query(query, [id_item]);
    return rows[0] || null;
  }

  static async createCheckout(pool, data) {
    const {
      id_user,
      status = "OPEN",
      currency = "BRL",
      subtotal_cents = 0,
      discount_cents = 0,
      total_cents = 0,
      expires_at = null,
      id_profile = null,
    } = data;

    const query = `
            INSERT INTO tb_checkout (
                id_user,
                status,
                currency,
                subtotal_cents,
                discount_cents,
                total_cents,
                expires_at,
                id_profile
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

    const values = [
      id_user,
      status,
      currency,
      subtotal_cents,
      discount_cents,
      total_cents,
      expires_at,
      id_profile,
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async createCheckoutItem(pool, data) {
    const {
      id_checkout,
      id_item,
      item_name_snapshot,
      unit_price_cents_snapshot,
      quantity = 1,
      total_cents,
      discount_cents = 0,
    } = data;

    const query = `
            INSERT INTO tb_checkout_item (
                id_checkout,
                id_item,
                item_name_snapshot,
                unit_price_cents_snapshot,
                quantity,
                total_cents,
                discount_cents
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;

    const values = [
      id_checkout,
      id_item,
      item_name_snapshot,
      unit_price_cents_snapshot,
      quantity,
      total_cents,
      discount_cents,
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async getCheckoutById(pool, id_checkout) {
    const query = `
            SELECT *
            FROM tb_checkout
            WHERE id_checkout = $1
              AND is_active = true
            LIMIT 1
        `;

    const { rows } = await pool.query(query, [id_checkout]);
    return rows[0] || null;
  }

  static async getCheckoutItemByCheckoutId(pool, id_checkout) {
    const query = `
        SELECT
            ci.*,
            i.desc_item AS current_item_name,
            i.unity_price_cents AS current_price_cents,
            i.is_active AS item_is_active
        FROM tb_checkout_item ci
        INNER JOIN tb_item i
            ON i.id_item = ci.id_item
        WHERE ci.id_checkout = $1
          AND ci.is_active = true
        ORDER BY ci.created_at ASC
        LIMIT 1
    `;

    const { rows } = await pool.query(query, [id_checkout]);
    return rows[0] || null;
  }

  static async listCheckoutItems(pool, id_checkout) {
    const query = `
        SELECT
            ci.*,
            i.desc_item AS current_item_name,
            i.unity_price_cents AS current_price_cents,
            i.is_active AS item_is_active
        FROM tb_checkout_item ci
        INNER JOIN tb_item i
            ON i.id_item = ci.id_item
        WHERE ci.id_checkout = $1
          AND ci.is_active = true
        ORDER BY ci.created_at ASC
    `;

    const { rows } = await pool.query(query, [id_checkout]);
    return rows;
  }

  static async getCheckoutCouponByCheckoutId(pool, id_checkout) {
    const query = `
            SELECT
                cc.*,
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
            FROM tb_checkout_coupon cc
            INNER JOIN tb_coupon c
                ON c.id_coupon = cc.id_coupon
            WHERE cc.id_checkout = $1
              AND cc.is_active = true
            ORDER BY cc.created_at DESC
            LIMIT 1
        `;

    const { rows } = await pool.query(query, [id_checkout]);
    return rows[0] || null;
  }

  static async getCouponByCode(pool, code) {
    const query = `
            SELECT
                id_coupon,
                code,
                discount_type,
                scope,
                apply_mode,
                max_discount_cents,
                min_order_cents,
                value,
                owner_user_id,
                max_uses,
                applies_to_item_id,
                expires_at,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            FROM tb_coupon
            WHERE UPPER(code) = UPPER($1)
            LIMIT 1
        `;

    const { rows } = await pool.query(query, [code]);
    return rows[0] || null;
  }

  static async getCouponById(pool, id_coupon) {
    const query = `
            SELECT
                id_coupon,
                code,
                discount_type,
                scope,
                apply_mode,
                max_discount_cents,
                min_order_cents,
                value,
                owner_user_id,
                max_uses,
                applies_to_item_id,
                expires_at,
                created_at,
                created_by,
                updated_at,
                updated_by,
                is_active
            FROM tb_coupon
            WHERE id_coupon = $1
            LIMIT 1
        `;

    const { rows } = await pool.query(query, [id_coupon]);
    return rows[0] || null;
  }

  static async countCouponUsage(pool, id_coupon) {
    const query = `
            SELECT COUNT(*)::int AS total
            FROM tb_order_coupon oc
            INNER JOIN tb_order o
                ON o.id_order = oc.id_order
            WHERE oc.id_coupon = $1
              AND COALESCE(oc.is_active, true) = true
              AND COALESCE(o.is_active, true) = true
              AND o.status IN ('PENDING_PAYMENT', 'PAID')
        `;

    const { rows } = await pool.query(query, [id_coupon]);
    return rows[0]?.total || 0;
  }

  static async deactivateCheckoutCoupons(pool, id_checkout, client = null) {
    const executor = client || pool;

    const query = `
            UPDATE tb_checkout_coupon
            SET is_active = false
            WHERE id_checkout = $1
              AND is_active = true
        `;

    await executor.query(query, [id_checkout]);
  }

  static async createCheckoutCoupon(pool, data, client = null) {
    const executor = client || pool;

    const { id_checkout, id_coupon, code_snapshot, discount_cents } = data;

    const query = `
            INSERT INTO tb_checkout_coupon (
                id_checkout,
                id_coupon,
                code_snapshot,
                discount_cents
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;

    const values = [id_checkout, id_coupon, code_snapshot, discount_cents];

    const { rows } = await executor.query(query, values);
    return rows[0];
  }

  static async updateCheckoutTotals(pool, data, client = null) {
    const executor = client || pool;

    const { id_checkout, subtotal_cents, discount_cents, total_cents } = data;

    const query = `
            UPDATE tb_checkout
            SET
                subtotal_cents = $2,
                discount_cents = $3,
                total_cents = $4,
                updated_at = NOW()
            WHERE id_checkout = $1
            RETURNING *
        `;

    const values = [id_checkout, subtotal_cents, discount_cents, total_cents];

    const { rows } = await executor.query(query, values);
    return rows[0] || null;
  }

  static async updateCheckoutItemDiscount(pool, data, client = null) {
    const executor = client || pool;

    const { id_checkout_item, discount_cents, total_cents } = data;

    const query = `
            UPDATE tb_checkout_item
            SET
                discount_cents = $2,
                total_cents = $3,
                updated_at = NOW()
            WHERE id_checkout_item = $1
            RETURNING *
        `;

    const values = [id_checkout_item, discount_cents, total_cents];

    const { rows } = await executor.query(query, values);
    return rows[0] || null;
  }

  static async resetCheckoutItemsDiscount(pool, id_checkout, client = null) {
    const executor = client || pool;

    const query = `
            UPDATE tb_checkout_item
            SET
                discount_cents = 0,
                total_cents = unit_price_cents_snapshot * quantity,
                updated_at = NOW()
            WHERE id_checkout = $1
              AND is_active = true
            RETURNING *
        `;

    const { rows } = await executor.query(query, [id_checkout]);
    return rows;
  }

  static async cancelCheckout(pool, id_checkout) {
    const query = `
            UPDATE tb_checkout
            SET
                status = 'CANCELED',
                updated_at = NOW()
            WHERE id_checkout = $1
            RETURNING *
        `;

    const { rows } = await pool.query(query, [id_checkout]);
    return rows[0] || null;
  }

  static async getCheckoutSummary(pool, id_checkout) {
    const checkout = await this.getCheckoutById(pool, id_checkout);

    if (!checkout) {
      return null;
    }

    const items = await this.listCheckoutItems(pool, id_checkout);
    const coupon = await this.getCheckoutCouponByCheckoutId(pool, id_checkout);

    return {
      ...checkout,
      items,
      coupon,
    };
  }

  static async confirmCheckout(pool, data) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const {
        checkout,
        checkout_item,
        coupon,
        payment_method,
        subtotal_cents,
        total_cents,
        payment_provider = null,
        payment_provider_ref = null,
        payment_url = null,
        expires_at = null,
        id_profile = null,
      } = data;

      const insertOrderQuery = `
                INSERT INTO tb_order (
                    id_user,
                    status,
                    subtotal_cents,
                    total_cents,
                    currency,
                    id_checkout,
                    payment_provider,
                    payment_provider_ref,
                    payment_url,
                    expires_at,
                    id_profile
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *
            `;

      const orderValues = [
        checkout.id_user,
        "PENDING_PAYMENT",
        subtotal_cents,
        total_cents,
        checkout.currency || "BRL",
        checkout.id_checkout,
        payment_provider || payment_method || null,
        payment_provider_ref,
        payment_url,
        expires_at,
        id_profile,
      ];

      const orderResult = await client.query(insertOrderQuery, orderValues);
      const order = orderResult.rows[0];

      const insertOrderItemQuery = `
                INSERT INTO tb_order_item (
                    id_order,
                    id_item,
                    item_name_snapshot,
                    unit_price_cents_snapshot,
                    quantity,
                    total_cents,
                    discount_cents,
                    created_by,
                    updated_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `;

      const orderItemValues = [
        order.id_order,
        checkout_item.id_item,
        checkout_item.item_name_snapshot,
        checkout_item.unit_price_cents_snapshot,
        checkout_item.quantity,
        checkout_item.total_cents,
        checkout_item.discount_cents,
        checkout.id_user,
        checkout.id_user,
      ];

      const orderItemResult = await client.query(
        insertOrderItemQuery,
        orderItemValues
      );
      const order_item = orderItemResult.rows[0];

      let order_coupon = null;

      if (coupon) {
        const insertOrderCouponQuery = `
                    INSERT INTO tb_order_coupon (
                        id_coupon,
                        id_order,
                        code_snapshot,
                        discount_cents,
                        created_by,
                        updated_by
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING *
                `;

        const orderCouponValues = [
          coupon.id_coupon,
          order.id_order,
          coupon.code_snapshot || coupon.code,
          coupon.discount_cents,
          checkout.id_user,
          checkout.id_user,
        ];

        const orderCouponResult = await client.query(
          insertOrderCouponQuery,
          orderCouponValues
        );
        order_coupon = orderCouponResult.rows[0];

        // Busca o cupom completo (owner_user_id) pra decidir se gera conversão de afiliado.
        const couponRowRes = await client.query(
          `SELECT id_coupon, code, owner_user_id FROM tb_coupon WHERE id_coupon = $1 LIMIT 1`,
          [coupon.id_coupon]
        );
        const couponRow = couponRowRes.rows[0];
        if (couponRow?.owner_user_id) {
          await AffiliateConversionService.createFromOrder(client, {
            order,
            order_coupon,
            coupon: couponRow,
          });
        }
      }

      const updateCheckoutQuery = `
                UPDATE tb_checkout
                SET
                    status = 'COMPLETED',
                    approved_at = NOW(),
                    updated_at = NOW(),
                    id_profile = COALESCE($2::uuid, id_profile)
                WHERE id_checkout = $1
                RETURNING *
            `;

      const checkoutResult = await client.query(updateCheckoutQuery, [
        checkout.id_checkout,
        id_profile,
      ]);
      const updated_checkout = checkoutResult.rows[0];

      await client.query("COMMIT");

      return {
        order,
        order_item,
        order_coupon,
        checkout: updated_checkout,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async updateOrderPayment(pool, data, client = null) {
    const executor = client || pool;

    const {
      id_order,
      payment_provider,
      payment_provider_ref,
      payment_url,
      expires_at,
    } = data;

    const query = `
        UPDATE tb_order
        SET
            payment_provider = $2,
            payment_provider_ref = $3,
            payment_url = $4,
            expires_at = $5,
            updated_at = NOW()
        WHERE id_order = $1
        RETURNING *
    `;

    const values = [
      id_order,
      payment_provider,
      payment_provider_ref,
      payment_url,
      expires_at,
    ];

    const { rows } = await executor.query(query, values);
    return rows[0] || null;
  }
}

module.exports = CheckoutStorage;
