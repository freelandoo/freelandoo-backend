class AffiliateStorage {
  // ───────────────────────── Affiliate ─────────────────────────
  static async getAffiliateByUserId(conn, id_user) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM tb_affiliate
      WHERE id_user = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [id_user]
    );
    return rows[0] || null;
  }

  static async getAffiliateById(conn, id_affiliate) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM tb_affiliate
      WHERE id_affiliate = $1
      LIMIT 1
      `,
      [id_affiliate]
    );
    return rows[0] || null;
  }

  // ───────────────────────── Settings (versioned) ─────────────────────────
  /** Returns the settings row effective at the given timestamp, or latest if null. */
  static async getEffectiveSettings(conn, at = null) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM tb_affiliate_settings
      WHERE effective_from <= COALESCE($1, NOW())
      ORDER BY effective_from DESC
      LIMIT 1
      `,
      [at]
    );
    return rows[0] || null;
  }

  // ───────────────────────── Coupon override ─────────────────────────
  static async getCouponOverride(conn, id_coupon) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM tb_affiliate_coupon_override
      WHERE id_coupon = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [id_coupon]
    );
    return rows[0] || null;
  }

  // ───────────────────────── Conversion ─────────────────────────
  static async createConversion(conn, data) {
    const {
      id_affiliate,
      id_order,
      id_order_coupon,
      id_coupon,
      status = "PENDING",
      order_total_cents,
      discount_cents,
      commission_base_cents,
      commission_percent,
      commission_cents,
      rule_snapshot,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO tb_affiliate_conversion (
        id_affiliate,
        id_order,
        id_order_coupon,
        id_coupon,
        status,
        order_total_cents,
        discount_cents,
        commission_base_cents,
        commission_percent,
        commission_cents,
        rule_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id_order_coupon) DO NOTHING
      RETURNING *
      `,
      [
        id_affiliate,
        id_order,
        id_order_coupon,
        id_coupon,
        status,
        order_total_cents,
        discount_cents,
        commission_base_cents,
        commission_percent,
        commission_cents,
        rule_snapshot,
      ]
    );
    return rows[0] || null;
  }

  static async getConversionByOrderId(conn, id_order) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM tb_affiliate_conversion
      WHERE id_order = $1
      LIMIT 1
      `,
      [id_order]
    );
    return rows[0] || null;
  }

  static async updateConversionStatus(conn, data) {
    const {
      id_conversion,
      status,
      eligible_at = null,
      approved_at = null,
      reversed_at = null,
      paid_at = null,
      reversal_reason = null,
      disputed = null,
    } = data;

    const { rows } = await conn.query(
      `
      UPDATE tb_affiliate_conversion
      SET
        status          = $2,
        eligible_at     = COALESCE($3, eligible_at),
        approved_at     = COALESCE($4, approved_at),
        reversed_at     = COALESCE($5, reversed_at),
        paid_at         = COALESCE($6, paid_at),
        reversal_reason = COALESCE($7, reversal_reason),
        disputed        = COALESCE($8, disputed),
        updated_at      = NOW()
      WHERE id_conversion = $1
      RETURNING *
      `,
      [
        id_conversion,
        status,
        eligible_at,
        approved_at,
        reversed_at,
        paid_at,
        reversal_reason,
        disputed,
      ]
    );
    return rows[0] || null;
  }

  // ───────────────────────── Conversion listing / aggregates ─────────────────────────
  /**
   * Lista conversões com filtros. Retorna { items, total }.
   * filters: { id_affiliate?, status?, from?, to?, code?, id_coupon? }
   */
  static async listConversions(conn, filters = {}, { page = 1, limit = 20 } = {}) {
    const where = [];
    const values = [];
    let i = 0;

    if (filters.id_affiliate) {
      where.push(`c.id_affiliate = $${++i}`);
      values.push(filters.id_affiliate);
    }
    if (filters.status) {
      where.push(`c.status = $${++i}`);
      values.push(filters.status);
    }
    if (filters.from) {
      where.push(`c.created_at >= $${++i}`);
      values.push(filters.from);
    }
    if (filters.to) {
      where.push(`c.created_at <= $${++i}`);
      values.push(filters.to);
    }
    if (filters.id_coupon) {
      where.push(`c.id_coupon = $${++i}`);
      values.push(filters.id_coupon);
    }
    if (filters.code) {
      where.push(`UPPER(cp.code) LIKE UPPER($${++i})`);
      values.push(`%${filters.code}%`);
    }
    if (filters.eligible_only) {
      where.push(`c.status = 'APPROVED' AND c.eligible_at <= NOW() AND c.id_payout_item IS NULL`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRes = await conn.query(
      `
      SELECT COUNT(*)::int AS total
      FROM tb_affiliate_conversion c
      INNER JOIN tb_coupon cp ON cp.id_coupon = c.id_coupon
      ${whereSql}
      `,
      values
    );
    const total = totalRes.rows[0]?.total || 0;

    const offset = (page - 1) * limit;
    const dataRes = await conn.query(
      `
      SELECT
        c.*,
        cp.code AS coupon_code,
        o.status AS order_status,
        o.paid_at AS order_paid_at,
        u.name AS affiliate_name
      FROM tb_affiliate_conversion c
      INNER JOIN tb_coupon cp ON cp.id_coupon = c.id_coupon
      INNER JOIN tb_order  o  ON o.id_order = c.id_order
      INNER JOIN tb_affiliate a ON a.id_affiliate = c.id_affiliate
      LEFT  JOIN tb_user u    ON u.id_user = a.id_user
      ${whereSql}
      ORDER BY c.created_at DESC
      LIMIT $${i + 1} OFFSET $${i + 2}
      `,
      [...values, limit, offset]
    );

    return { items: dataRes.rows, total, page, limit };
  }

  /**
   * Agregados para o dashboard do afiliado.
   * Retorna totais em centavos por status + contagem.
   */
  static async aggregatesForAffiliate(conn, id_affiliate) {
    const { rows } = await conn.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'PENDING'  THEN commission_cents ELSE 0 END), 0)::int AS pending_cents,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN commission_cents ELSE 0 END), 0)::int AS approved_cents,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' AND eligible_at <= NOW() AND id_payout_item IS NULL THEN commission_cents ELSE 0 END), 0)::int AS eligible_cents,
        COALESCE(SUM(CASE WHEN status = 'PAID'     THEN commission_cents ELSE 0 END), 0)::int AS paid_cents,
        COALESCE(SUM(CASE WHEN status = 'REVERSED' THEN commission_cents ELSE 0 END), 0)::int AS reversed_cents,
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE status IN ('APPROVED','PAID'))::int AS converted_count
      FROM tb_affiliate_conversion
      WHERE id_affiliate = $1
      `,
      [id_affiliate]
    );
    return rows[0];
  }

  /**
   * Listagem de afiliados (admin) com agregados rápidos. Paginado.
   */
  static async listAffiliates(conn, filters = {}, { page = 1, limit = 20 } = {}) {
    const where = [`a.is_active = TRUE`];
    const values = [];
    let i = 0;

    if (filters.status) {
      where.push(`a.status = $${++i}`);
      values.push(filters.status);
    }
    if (filters.q) {
      where.push(`(u.name ILIKE $${++i} OR u.email ILIKE $${i})`);
      values.push(`%${filters.q}%`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const totalRes = await conn.query(
      `
      SELECT COUNT(*)::int AS total
      FROM tb_affiliate a
      INNER JOIN tb_user u ON u.id_user = a.id_user
      ${whereSql}
      `,
      values
    );
    const total = totalRes.rows[0]?.total || 0;

    const offset = (page - 1) * limit;
    const dataRes = await conn.query(
      `
      SELECT
        a.*,
        u.name  AS user_name,
        u.email AS user_email,
        agg.commission_total_cents,
        agg.conversions_count
      FROM tb_affiliate a
      INNER JOIN tb_user u ON u.id_user = a.id_user
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(commission_cents), 0)::int AS commission_total_cents,
          COUNT(*)::int AS conversions_count
        FROM tb_affiliate_conversion
        WHERE id_affiliate = a.id_affiliate
      ) agg ON TRUE
      ${whereSql}
      ORDER BY agg.commission_total_cents DESC NULLS LAST
      LIMIT $${i + 1} OFFSET $${i + 2}
      `,
      [...values, limit, offset]
    );

    return { items: dataRes.rows, total, page, limit };
  }

  // ───────────────────────── Settings / Override writes ─────────────────────────
  static async createSettings(conn, data) {
    const {
      default_commission_percent,
      commission_base = "NET_OF_DISCOUNT",
      min_order_cents = 0,
      max_commission_cents = null,
      approval_delay_days = 30,
      effective_from = null,
      notes = null,
      created_by = null,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO tb_affiliate_settings (
        default_commission_percent,
        commission_base,
        min_order_cents,
        max_commission_cents,
        approval_delay_days,
        effective_from,
        notes,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), $7, $8)
      RETURNING *
      `,
      [
        default_commission_percent,
        commission_base,
        min_order_cents,
        max_commission_cents,
        approval_delay_days,
        effective_from,
        notes,
        created_by,
      ]
    );
    return rows[0];
  }

  static async listSettings(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM tb_affiliate_settings ORDER BY effective_from DESC`
    );
    return rows;
  }

  static async upsertCouponOverride(conn, data) {
    const {
      id_coupon,
      commission_percent,
      commission_base,
      max_commission_cents,
      approval_delay_days,
      updated_by = null,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO tb_affiliate_coupon_override (
        id_coupon,
        commission_percent,
        commission_base,
        max_commission_cents,
        approval_delay_days,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      ON CONFLICT (id_coupon) DO UPDATE SET
        commission_percent   = EXCLUDED.commission_percent,
        commission_base      = EXCLUDED.commission_base,
        max_commission_cents = EXCLUDED.max_commission_cents,
        approval_delay_days  = EXCLUDED.approval_delay_days,
        updated_by           = EXCLUDED.updated_by,
        updated_at           = NOW(),
        is_active            = TRUE
      RETURNING *
      `,
      [
        id_coupon,
        commission_percent,
        commission_base,
        max_commission_cents,
        approval_delay_days,
        updated_by,
      ]
    );
    return rows[0];
  }

  static async deleteCouponOverride(conn, id_coupon) {
    await conn.query(
      `UPDATE tb_affiliate_coupon_override SET is_active = FALSE, updated_at = NOW() WHERE id_coupon = $1`,
      [id_coupon]
    );
  }

  // ───────────────────────── Affiliate writes ─────────────────────────
  static async upsertAffiliate(conn, data) {
    const {
      id_user,
      status = "ACTIVE",
      pix_key = null,
      pix_key_type = null,
      legal_name = null,
      tax_id = null,
      notes = null,
      created_by = null,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO tb_affiliate (
        id_user, status, pix_key, pix_key_type, legal_name, tax_id, notes, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      ON CONFLICT (id_user) DO UPDATE SET
        status       = EXCLUDED.status,
        pix_key      = COALESCE(EXCLUDED.pix_key, tb_affiliate.pix_key),
        pix_key_type = COALESCE(EXCLUDED.pix_key_type, tb_affiliate.pix_key_type),
        legal_name   = COALESCE(EXCLUDED.legal_name, tb_affiliate.legal_name),
        tax_id       = COALESCE(EXCLUDED.tax_id, tb_affiliate.tax_id),
        notes        = COALESCE(EXCLUDED.notes, tb_affiliate.notes),
        updated_by   = EXCLUDED.updated_by,
        updated_at   = NOW(),
        is_active    = TRUE
      RETURNING *
      `,
      [id_user, status, pix_key, pix_key_type, legal_name, tax_id, notes, created_by]
    );
    return rows[0];
  }

  static async updateAffiliatePayoutInfo(conn, { id_affiliate, pix_key, pix_key_type, legal_name, tax_id, updated_by }) {
    const { rows } = await conn.query(
      `
      UPDATE tb_affiliate
      SET pix_key      = COALESCE($2, pix_key),
          pix_key_type = COALESCE($3, pix_key_type),
          legal_name   = COALESCE($4, legal_name),
          tax_id       = COALESCE($5, tax_id),
          updated_by   = $6,
          updated_at   = NOW()
      WHERE id_affiliate = $1
      RETURNING *
      `,
      [id_affiliate, pix_key, pix_key_type, legal_name, tax_id, updated_by]
    );
    return rows[0] || null;
  }

  static async updateAffiliateStatus(conn, { id_affiliate, status, updated_by }) {
    const { rows } = await conn.query(
      `
      UPDATE tb_affiliate
      SET status = $2, updated_by = $3, updated_at = NOW()
      WHERE id_affiliate = $1
      RETURNING *
      `,
      [id_affiliate, status, updated_by]
    );
    return rows[0] || null;
  }

  // ───────────────────────── Audit log ─────────────────────────
  static async writeAudit(conn, { entity, entity_id, action, before_state = null, after_state = null, reason = null, actor_user_id = null }) {
    await conn.query(
      `
      INSERT INTO tb_affiliate_audit_log (entity, entity_id, action, before_state, after_state, reason, actor_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [entity, entity_id, action, before_state, after_state, reason, actor_user_id]
    );
  }

  // ───────────────────────── Event (idempotency) ─────────────────────────
  /**
   * Idempotent insert. Returns the row if inserted, null if duplicate.
   */
  static async recordConversionEvent(conn, data) {
    const {
      id_conversion,
      source,
      source_event_id,
      from_status = null,
      to_status,
      payload = null,
    } = data;

    const { rows } = await conn.query(
      `
      INSERT INTO tb_affiliate_conversion_event (
        id_conversion,
        source,
        source_event_id,
        from_status,
        to_status,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (source, source_event_id) DO NOTHING
      RETURNING *
      `,
      [id_conversion, source, source_event_id, from_status, to_status, payload]
    );
    return rows[0] || null;
  }

  // ───────────────────────── Audit queries ─────────────────────────
  static async listAudit(conn, { entity = null, action = null, actor_user_id = null, entity_id = null } = {}, { page = 1, limit = 50 } = {}) {
    const where = [];
    const params = [];
    if (entity) { params.push(entity); where.push(`l.entity = $${params.length}`); }
    if (action) { params.push(action); where.push(`l.action = $${params.length}`); }
    if (actor_user_id) { params.push(actor_user_id); where.push(`l.actor_user_id = $${params.length}`); }
    if (entity_id) { params.push(entity_id); where.push(`l.entity_id = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit, (page - 1) * limit);
    const { rows } = await conn.query(
      `
      SELECT l.*, u.nome AS actor_nome, u.email AS actor_email
      FROM tb_affiliate_audit_log l
      LEFT JOIN tb_user u ON u.id_user = l.actor_user_id
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    return rows;
  }

  // ───────────────────────── Overview (metrics) ─────────────────────────
  static async overviewMetrics(conn) {
    const { rows: aff } = await conn.query(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE status = 'PAUSED')::int AS paused,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked
      FROM tb_affiliate
      WHERE is_active = TRUE
      `
    );
    const { rows: conv } = await conn.query(
      `
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN status = 'PENDING'  THEN commission_cents ELSE 0 END), 0)::int AS pending_cents,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN commission_cents ELSE 0 END), 0)::int AS approved_cents,
        COALESCE(SUM(CASE WHEN status = 'PAID'     THEN commission_cents ELSE 0 END), 0)::int AS paid_cents,
        COALESCE(SUM(CASE WHEN status = 'REVERSED' THEN commission_cents ELSE 0 END), 0)::int AS reversed_cents,
        COUNT(*) FILTER (WHERE disputed = TRUE)::int AS disputed_count
      FROM tb_affiliate_conversion
      `
    );
    const { rows: batch } = await conn.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent,
        COALESCE(SUM(CASE WHEN status IN ('DRAFT','SENT') THEN total_cents ELSE 0 END), 0)::int AS open_cents
      FROM tb_affiliate_payout_batch
      `
    );
    const { rows: top } = await conn.query(
      `
      SELECT a.id_affiliate, u.nome, u.email,
             COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status IN ('APPROVED','PAID')), 0)::int AS earned_cents,
             COUNT(c.id_conversion) FILTER (WHERE c.status IN ('APPROVED','PAID'))::int AS conversions
      FROM tb_affiliate a
      LEFT JOIN tb_user u ON u.id_user = a.id_user
      LEFT JOIN tb_affiliate_conversion c ON c.id_affiliate = a.id_affiliate
      WHERE a.is_active = TRUE
      GROUP BY a.id_affiliate, u.nome, u.email
      ORDER BY earned_cents DESC
      LIMIT 5
      `
    );
    return {
      affiliates: aff[0],
      conversions: conv[0],
      batches: batch[0],
      top_affiliates: top,
    };
  }

  // ───────────────────────── Dispute resolution ─────────────────────────
  static async resolveDispute(conn, { id_conversion, new_status = null, clear_disputed = true }) {
    const sets = ["disputed = CASE WHEN $2::bool THEN FALSE ELSE disputed END", "updated_at = NOW()"];
    const params = [id_conversion, clear_disputed];
    if (new_status) {
      params.push(new_status);
      sets.push(`status = $${params.length}`);
      if (new_status === "REVERSED") sets.push("reversed_at = NOW()");
    }
    const { rows } = await conn.query(
      `UPDATE tb_affiliate_conversion SET ${sets.join(", ")} WHERE id_conversion = $1 RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  // ───────────────────────── Payouts ─────────────────────────
  static async listEligibleConversions(conn, id_affiliate) {
    const { rows } = await conn.query(
      `
      SELECT id_conversion, commission_cents, eligible_at, id_order
      FROM tb_affiliate_conversion
      WHERE id_affiliate = $1
        AND status = 'APPROVED'
        AND eligible_at <= NOW()
        AND id_payout_item IS NULL
        AND disputed = FALSE
      ORDER BY eligible_at ASC
      `,
      [id_affiliate]
    );
    return rows;
  }

  static async createPayoutBatch(conn, {
    id_affiliate,
    period_start,
    period_end,
    conversion_ids,
    pix_key_snapshot,
    notes,
    created_by,
  }) {
    const eligible = await conn.query(
      `
      SELECT id_conversion, commission_cents
      FROM tb_affiliate_conversion
      WHERE id_affiliate = $1
        AND status = 'APPROVED'
        AND eligible_at <= NOW()
        AND id_payout_item IS NULL
        AND disputed = FALSE
        AND id_conversion = ANY($2::uuid[])
      FOR UPDATE
      `,
      [id_affiliate, conversion_ids]
    );
    if (eligible.rows.length === 0) {
      const err = new Error("Nenhuma conversão elegível");
      err.status = 400;
      throw err;
    }

    const total = eligible.rows.reduce((s, r) => s + r.commission_cents, 0);

    const { rows: batchRows } = await conn.query(
      `
      INSERT INTO tb_affiliate_payout_batch (
        id_affiliate, period_start, period_end, total_cents,
        status, pix_key_snapshot, notes, created_by
      )
      VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7)
      RETURNING *
      `,
      [id_affiliate, period_start, period_end, total, pix_key_snapshot, notes, created_by]
    );
    const batch = batchRows[0];

    for (const conv of eligible.rows) {
      const { rows: itemRows } = await conn.query(
        `
        INSERT INTO tb_affiliate_payout_item (id_batch, id_conversion, commission_cents)
        VALUES ($1, $2, $3)
        RETURNING id_item
        `,
        [batch.id_batch, conv.id_conversion, conv.commission_cents]
      );
      await conn.query(
        `UPDATE tb_affiliate_conversion SET id_payout_item = $1 WHERE id_conversion = $2`,
        [itemRows[0].id_item, conv.id_conversion]
      );
    }

    return batch;
  }

  static async listPayoutBatches(conn, { id_affiliate = null, status = null } = {}, { page = 1, limit = 20 } = {}) {
    const where = [];
    const params = [];
    if (id_affiliate) { params.push(id_affiliate); where.push(`b.id_affiliate = $${params.length}`); }
    if (status) { params.push(status); where.push(`b.status = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit, (page - 1) * limit);
    const { rows } = await conn.query(
      `
      SELECT b.*,
             a.id_user AS affiliate_user_id,
             u.nome    AS affiliate_user_nome,
             u.email   AS affiliate_user_email
      FROM tb_affiliate_payout_batch b
      JOIN tb_affiliate a ON a.id_affiliate = b.id_affiliate
      LEFT JOIN tb_user u ON u.id_user = a.id_user
      ${whereSql}
      ORDER BY b.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    return rows;
  }

  static async getPayoutBatchWithItems(conn, id_batch) {
    const { rows: b } = await conn.query(
      `SELECT * FROM tb_affiliate_payout_batch WHERE id_batch = $1`,
      [id_batch]
    );
    if (b.length === 0) return null;
    const { rows: items } = await conn.query(
      `
      SELECT i.*, c.id_order, cp.code AS coupon_code, c.commission_cents AS conv_commission
      FROM tb_affiliate_payout_item i
      JOIN tb_affiliate_conversion c ON c.id_conversion = i.id_conversion
      LEFT JOIN tb_coupon cp ON cp.id_coupon = c.id_coupon
      WHERE i.id_batch = $1
      ORDER BY i.created_at ASC
      `,
      [id_batch]
    );
    return { ...b[0], items };
  }

  static async markBatchStatus(conn, { id_batch, status, receipt_url = null, paid_by = null }) {
    const { rows } = await conn.query(
      `
      UPDATE tb_affiliate_payout_batch
      SET status = $2,
          receipt_url = COALESCE($3, receipt_url),
          paid_at = CASE WHEN $2 = 'PAID' THEN NOW() ELSE paid_at END,
          paid_by = CASE WHEN $2 = 'PAID' THEN $4 ELSE paid_by END
      WHERE id_batch = $1
      RETURNING *
      `,
      [id_batch, status, receipt_url, paid_by]
    );
    return rows[0] || null;
  }

  static async setConversionsPaidForBatch(conn, id_batch) {
    await conn.query(
      `
      UPDATE tb_affiliate_conversion c
      SET status = 'PAID', paid_at = NOW()
      FROM tb_affiliate_payout_item i
      WHERE i.id_batch = $1
        AND c.id_conversion = i.id_conversion
        AND c.status = 'APPROVED'
      `,
      [id_batch]
    );
  }

  static async unlinkBatchItems(conn, id_batch) {
    await conn.query(
      `
      UPDATE tb_affiliate_conversion
      SET id_payout_item = NULL
      WHERE id_payout_item IN (
        SELECT id_item FROM tb_affiliate_payout_item WHERE id_batch = $1
      )
      `,
      [id_batch]
    );
    await conn.query(`DELETE FROM tb_affiliate_payout_item WHERE id_batch = $1`, [id_batch]);
  }
}

module.exports = AffiliateStorage;
