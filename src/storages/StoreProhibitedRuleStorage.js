class StoreProhibitedRuleStorage {
  static async listActive(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_store_prohibited_rule
        WHERE status = 'active'
        ORDER BY severity DESC, id_rule ASC`
    );
    return rows;
  }

  static async listAll(conn, { status = null } = {}) {
    const params = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE status = $1`;
    }
    const { rows } = await conn.query(
      `SELECT r.*, pc.name AS category_name
         FROM public.tb_store_prohibited_rule r
    LEFT JOIN public.tb_product_category pc ON pc.id_product_category = r.id_product_category
        ${where}
        ORDER BY r.updated_at DESC`,
      params
    );
    return rows;
  }

  static async getById(conn, id_rule) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_store_prohibited_rule WHERE id_rule = $1 LIMIT 1`,
      [id_rule]
    );
    return rows[0] || null;
  }

  static async create(conn, {
    rule_type, term, normalized_term, id_product_category,
    severity, action, reason, status, created_by_user_id,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_store_prohibited_rule
        (rule_type, term, normalized_term, id_product_category,
         severity, action, reason, status, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        rule_type, term || null, normalized_term || null,
        id_product_category || null,
        severity || "medium", action || "review",
        reason || null, status || "active",
        created_by_user_id || null,
      ]
    );
    return rows[0];
  }

  static async update(conn, id_rule, patch) {
    const allowed = ["rule_type", "term", "normalized_term", "id_product_category", "severity", "action", "reason", "status"];
    const fields = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        fields.push(`${k} = $${i++}`);
        values.push(patch[k]);
      }
    }
    if (!fields.length) return this.getById(conn, id_rule);
    fields.push("updated_at = NOW()");
    values.push(id_rule);
    const { rows } = await conn.query(
      `UPDATE public.tb_store_prohibited_rule SET ${fields.join(", ")}
        WHERE id_rule = $${i} RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async remove(conn, id_rule) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_store_prohibited_rule WHERE id_rule = $1`,
      [id_rule]
    );
    return rowCount > 0;
  }

  // Drill-down: produtos afetados (moderation_status != 'active' que estão
  // ligados à categoria da regra ou cujo título/descrição contém o termo).
  static async occurrencesForRule(conn, rule, { limit = 100 } = {}) {
    const out = { products: [], requests: [] };
    if (rule.rule_type === "category" || rule.rule_type === "ban_category") {
      if (rule.id_product_category) {
        const { rows: products } = await conn.query(
          `SELECT id_profile_product, name, moderation_status, created_at
             FROM public.tb_profile_product
            WHERE id_product_category = $1
              AND moderation_status IN ('pending_review','blocked','banned')
            ORDER BY created_at DESC LIMIT $2`,
          [rule.id_product_category, limit]
        );
        out.products = products;
        const { rows: requests } = await conn.query(
          `SELECT id_product_request, title, moderation_status, created_at
             FROM public.tb_product_request
            WHERE id_product_category = $1
              AND moderation_status IN ('pending_review','blocked','banned')
            ORDER BY created_at DESC LIMIT $2`,
          [rule.id_product_category, limit]
        );
        out.requests = requests;
      }
    } else if (rule.normalized_term) {
      const like = `%${rule.normalized_term}%`;
      const { rows: products } = await conn.query(
        `SELECT id_profile_product, name, moderation_status, created_at
           FROM public.tb_profile_product
          WHERE moderation_status IN ('pending_review','blocked','banned')
            AND (LOWER(name) LIKE $1 OR LOWER(description) LIKE $1)
          ORDER BY created_at DESC LIMIT $2`,
        [like, limit]
      );
      out.products = products;
      const { rows: requests } = await conn.query(
        `SELECT id_product_request, title, moderation_status, created_at
           FROM public.tb_product_request
          WHERE moderation_status IN ('pending_review','blocked','banned')
            AND (LOWER(title) LIKE $1 OR LOWER(description) LIKE $1)
          ORDER BY created_at DESC LIMIT $2`,
        [like, limit]
      );
      out.requests = requests;
    }
    return out;
  }
}

module.exports = StoreProhibitedRuleStorage;
