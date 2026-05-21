class ManifestationStorage {
  // ---------- Categories ----------

  static async listCategories(conn, { onlyActive = false } = {}) {
    const where = onlyActive ? "WHERE is_active = TRUE" : "";
    const { rows } = await conn.query(
      `SELECT * FROM public.manifestation_categories
       ${where}
       ORDER BY sort_order ASC, name ASC`
    );
    return rows;
  }

  static async getCategoryById(conn, id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.manifestation_categories WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async getCategoryBySlug(conn, slug) {
    const { rows } = await conn.query(
      `SELECT * FROM public.manifestation_categories WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    return rows[0] || null;
  }

  static async createCategory(conn, { slug, name, sort_order = 0, is_active = true }) {
    const { rows } = await conn.query(
      `INSERT INTO public.manifestation_categories (slug, name, sort_order, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [slug, name, sort_order, is_active]
    );
    return rows[0];
  }

  static async updateCategory(conn, id, patch) {
    const allowed = ["slug", "name", "sort_order", "is_active"];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getCategoryById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.manifestation_categories SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async deleteCategory(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.manifestation_categories WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  }

  // ---------- Products ----------

  static async listProducts(conn, { onlyActive = false, categoryId = null, limit = null, offset = 0 } = {}) {
    const conds = [];
    const values = [];
    let i = 1;
    if (onlyActive) conds.push("p.is_active = TRUE");
    if (categoryId) {
      conds.push(`p.category_id = $${i++}`);
      values.push(categoryId);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `
      SELECT p.*,
             c.slug AS category_slug,
             c.name AS category_name
        FROM public.manifestation_products p
        LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
       ${where}
       ORDER BY p.is_featured DESC, p.sort_order ASC, p.name ASC`;
    if (limit != null) {
      sql += ` LIMIT $${i++} OFFSET $${i++}`;
      values.push(limit, offset);
    }
    const { rows } = await conn.query(sql, values);
    return rows;
  }

  static async getProductById(conn, id) {
    const { rows } = await conn.query(
      `SELECT p.*,
              c.slug AS category_slug,
              c.name AS category_name
         FROM public.manifestation_products p
         LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
        WHERE p.id = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async getFeaturedProduct(conn) {
    const { rows } = await conn.query(
      `SELECT p.*,
              c.slug AS category_slug,
              c.name AS category_name
         FROM public.manifestation_products p
         LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
        WHERE p.is_featured = TRUE AND p.is_active = TRUE
        LIMIT 1`
    );
    return rows[0] || null;
  }

  static async createProduct(conn, data) {
    const {
      category_id = null,
      name,
      description = null,
      banner_url,
      banner_thumb_url = null,
      tag_label,
      tag_color = "emerald",
      tag_icon = null,
      price_cents = 0,
      price_polens = 0,
      duration_days = 365,
      stock = null,
      is_featured = false,
      is_active = true,
      sort_order = 0,
    } = data;
    const { rows } = await conn.query(
      `INSERT INTO public.manifestation_products
         (category_id, name, description, banner_url, banner_thumb_url,
          tag_label, tag_color, tag_icon,
          price_cents, price_polens, duration_days, stock,
          is_featured, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        category_id,
        name,
        description,
        banner_url,
        banner_thumb_url,
        tag_label,
        tag_color,
        tag_icon,
        price_cents,
        price_polens,
        duration_days,
        stock,
        is_featured,
        is_active,
        sort_order,
      ]
    );
    return rows[0];
  }

  static async updateProduct(conn, id, patch) {
    const allowed = [
      "category_id",
      "name",
      "description",
      "banner_url",
      "banner_thumb_url",
      "tag_label",
      "tag_color",
      "tag_icon",
      "price_cents",
      "price_polens",
      "duration_days",
      "stock",
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
      `UPDATE public.manifestation_products SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async deleteProduct(conn, id) {
    // Soft-delete via is_active=false (referenciado por user_manifestations).
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET is_active = FALSE,
              is_featured = FALSE,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async setFeatured(conn, id) {
    // Garante apenas 1 destaque ativo (índice parcial UNIQUE protege).
    await conn.query(
      `UPDATE public.manifestation_products
          SET is_featured = FALSE, updated_at = NOW()
        WHERE is_featured = TRUE AND id <> $1`,
      [id]
    );
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET is_featured = TRUE, updated_at = NOW()
        WHERE id = $1 AND is_active = TRUE
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async unsetFeatured(conn, id) {
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET is_featured = FALSE, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  // ---------- Admin dashboard ----------

  static async adminDashboard(conn) {
    const [summary, byPayment, topProducts] = await Promise.all([
      conn.query(
        `SELECT
           (SELECT COUNT(DISTINCT user_id)::int
              FROM public.user_manifestations
             WHERE is_active = TRUE
               AND (expires_at IS NULL OR expires_at > NOW())) AS active_users,
           (SELECT COUNT(*)::int
              FROM public.user_manifestations um
              JOIN public.tb_profile p ON p.id_user = um.user_id
             WHERE um.is_active = TRUE
               AND (um.expires_at IS NULL OR um.expires_at > NOW())
               AND COALESCE(p.is_clan, FALSE) = FALSE
               AND p.deleted_at IS NULL) AS active_subprofile_apply,
           (SELECT COUNT(*)::int FROM public.manifestation_products) AS products_total,
           (SELECT COUNT(*)::int
              FROM public.manifestation_products
             WHERE is_active = TRUE) AS products_active,
           (SELECT COALESCE(SUM(amount_cents), 0)::int
              FROM public.user_manifestations
             WHERE acquired_at >= NOW() - INTERVAL '30 days') AS revenue_cents_30d,
           (SELECT COALESCE(SUM(amount_polens), 0)::int
              FROM public.user_manifestations
             WHERE acquired_at >= NOW() - INTERVAL '30 days') AS revenue_polens_30d`
      ),
      conn.query(
        `SELECT payment_method,
                COUNT(*)::int AS purchases,
                COALESCE(SUM(amount_cents), 0)::int AS revenue_cents,
                COALESCE(SUM(amount_polens), 0)::int AS revenue_polens
           FROM public.user_manifestations
          WHERE acquired_at >= NOW() - INTERVAL '30 days'
          GROUP BY payment_method
          ORDER BY purchases DESC`
      ),
      conn.query(
        `SELECT p.id,
                p.name,
                p.is_active,
                COUNT(um.id)::int AS purchases_30d,
                COUNT(*) FILTER (WHERE um.is_active = TRUE AND (um.expires_at IS NULL OR um.expires_at > NOW()))::int AS active_users,
                COALESCE(SUM(um.amount_cents), 0)::int AS revenue_cents_30d,
                COALESCE(SUM(um.amount_polens), 0)::int AS revenue_polens_30d
           FROM public.manifestation_products p
           LEFT JOIN public.user_manifestations um
             ON um.product_id = p.id
            AND um.acquired_at >= NOW() - INTERVAL '30 days'
          GROUP BY p.id, p.name, p.is_active
          ORDER BY purchases_30d DESC, active_users DESC, p.name ASC
          LIMIT 10`
      ),
    ]);

    return {
      summary: summary.rows[0] || {},
      by_payment_method_30d: byPayment.rows,
      top_products: topProducts.rows,
    };
  }

  static async countProductUsage(conn, productId, { q = "" } = {}) {
    const values = [productId];
    let search = "";
    if (q) {
      values.push(`%${q.toLowerCase()}%`);
      search = `AND (
        LOWER(COALESCE(u.username, '')) LIKE $2 OR
        LOWER(COALESCE(u.nome, '')) LIKE $2 OR
        LOWER(COALESCE(u.email, '')) LIKE $2
      )`;
    }
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS total
         FROM public.user_manifestations um
         JOIN public.tb_user u ON u.id_user = um.user_id
        WHERE um.product_id = $1
        ${search}`,
      values
    );
    return rows[0]?.total || 0;
  }

  static async listProductUsage(conn, productId, { q = "", limit = 20, offset = 0, sort = "acquired_at", order = "desc" } = {}) {
    const sortMap = {
      acquired_at: "um.acquired_at",
      expires_at: "um.expires_at",
      username: "u.username",
      payment_method: "um.payment_method",
    };
    const sortSql = sortMap[sort] || sortMap.acquired_at;
    const orderSql = String(order).toLowerCase() === "asc" ? "ASC" : "DESC";
    const values = [productId];
    let i = 2;
    let search = "";
    if (q) {
      values.push(`%${q.toLowerCase()}%`);
      search = `AND (
        LOWER(COALESCE(u.username, '')) LIKE $${i} OR
        LOWER(COALESCE(u.nome, '')) LIKE $${i} OR
        LOWER(COALESCE(u.email, '')) LIKE $${i}
      )`;
      i++;
    }
    values.push(limit, offset);
    const { rows } = await conn.query(
      `SELECT um.id,
              um.user_id,
              um.acquired_at,
              um.expires_at,
              um.is_active,
              um.payment_method,
              um.amount_cents,
              um.amount_polens,
              u.username,
              u.nome AS display_name,
              u.email,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'id_profile', p.id_profile,
                    'display_name', p.display_name,
                    'avatar_url', p.avatar_url
                  )
                  ORDER BY p.display_name
                ) FILTER (WHERE p.id_profile IS NOT NULL),
                '[]'::json
              ) AS subprofiles_applied
         FROM public.user_manifestations um
         JOIN public.tb_user u ON u.id_user = um.user_id
         LEFT JOIN public.tb_profile p
           ON p.id_user = um.user_id
          AND COALESCE(p.is_clan, FALSE) = FALSE
          AND p.deleted_at IS NULL
        WHERE um.product_id = $1
        ${search}
        GROUP BY um.id, u.id_user, u.username, u.nome, u.email
        ORDER BY ${sortSql} ${orderSql}, um.id DESC
        LIMIT $${i} OFFSET $${i + 1}`,
      values
    );
    return rows;
  }

  // ---------- User ownership / application ----------

  static async expireInactive(conn, userId = null) {
    const params = [];
    let userClause = "";
    if (userId) {
      params.push(userId);
      userClause = `AND user_id = $1`;
    }
    await conn.query(
      `UPDATE public.user_manifestations
          SET is_active = FALSE
        WHERE is_active = TRUE
          AND expires_at <= NOW()
          ${userClause}`,
      params
    );
  }

  static async getActiveForUser(conn, userId) {
    await this.expireInactive(conn, userId);
    const { rows } = await conn.query(
      `SELECT um.*,
              p.name,
              p.description,
              p.banner_url,
              p.banner_thumb_url,
              p.tag_label,
              p.tag_color,
              p.tag_icon,
              p.duration_days,
              p.category_id,
              c.name AS category_name,
              c.slug AS category_slug
         FROM public.user_manifestations um
         JOIN public.manifestation_products p ON p.id = um.product_id
         LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
        WHERE um.user_id = $1
          AND um.is_active = TRUE
          AND (um.expires_at IS NULL OR um.expires_at > NOW())
        ORDER BY um.acquired_at DESC
        LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  }

  static async getActiveForProfile(conn, profileId) {
    const { rows } = await conn.query(
      `SELECT um.*,
              p.name,
              p.banner_url,
              p.banner_thumb_url,
              p.tag_label,
              p.tag_color,
              p.tag_icon
         FROM public.user_manifestations um
         JOIN public.manifestation_products p ON p.id = um.product_id
         JOIN public.tb_profile tp ON tp.id_user = um.user_id
        WHERE tp.id_profile = $1
          AND um.is_active = TRUE
          AND (um.expires_at IS NULL OR um.expires_at > NOW())
          AND COALESCE(tp.is_clan, FALSE) = FALSE
          AND tp.deleted_at IS NULL
        LIMIT 1`,
      [profileId]
    );
    return rows[0] || null;
  }

  static async listHistoryForUser(conn, userId, { limit = 30, offset = 0 } = {}) {
    await this.expireInactive(conn, userId);
    const { rows } = await conn.query(
      `SELECT um.*,
              p.name,
              p.banner_url,
              p.tag_label,
              p.tag_color,
              p.tag_icon
         FROM public.user_manifestations um
         JOIN public.manifestation_products p ON p.id = um.product_id
        WHERE um.user_id = $1
        ORDER BY um.acquired_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  }

  static async listAppliedProfileIds(conn, userManifestationId) {
    const { rows } = await conn.query(
      `SELECT p.id_profile AS profile_id
         FROM public.user_manifestations um
         JOIN public.tb_profile p ON p.id_user = um.user_id
        WHERE um.id = $1
          AND COALESCE(p.is_clan, FALSE) = FALSE
          AND p.deleted_at IS NULL`,
      [userManifestationId]
    );
    return rows.map((r) => r.profile_id);
  }

  static async listOwnedProfilesForApply(conn, userId) {
    const { rows } = await conn.query(
      `SELECT p.id_profile,
              p.display_name,
              p.avatar_url,
              p.is_clan,
              p.deleted_at,
              p.is_active,
              p.is_visible,
              c.desc_category,
              c.profession_slug
         FROM public.tb_profile p
         LEFT JOIN public.tb_category c ON c.id_category = p.id_category
        WHERE p.id_user = $1
          AND p.deleted_at IS NULL
        ORDER BY COALESCE(p.is_clan, FALSE) ASC, p.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async deactivateActiveForUser(conn, userId) {
    await conn.query(
      `UPDATE public.user_manifestations
          SET is_active = FALSE
        WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );
  }

  // ---------- Biblioteca de desbloqueios (modelo Slice 089+) ----------
  // user_manifestations vira a tabela de desbloqueios: 1 linha por (user, produto),
  // permanente (expires_at NULL). is_active = a manifestação aplicada no headcard.

  static async getOwnedUnlock(conn, userId, productId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.user_manifestations
        WHERE user_id = $1 AND product_id = $2
        LIMIT 1`,
      [userId, productId]
    );
    return rows[0] || null;
  }

  static async listOwnedForUser(conn, userId) {
    const { rows } = await conn.query(
      `SELECT um.id,
              um.product_id,
              um.is_active,
              um.acquired_at,
              um.payment_method,
              um.amount_polens,
              p.slug,
              p.name,
              p.type,
              p.headline,
              p.description,
              p.banner_url
         FROM public.user_manifestations um
         JOIN public.manifestation_products p ON p.id = um.product_id
        WHERE um.user_id = $1
        ORDER BY um.acquired_at DESC`,
      [userId]
    );
    return rows;
  }

  // Cria o desbloqueio como NÃO aplicado. ON CONFLICT DO NOTHING => idempotente:
  // se o user já desbloqueou esse produto, retorna null (sem débito duplicado).
  static async createUnlock(conn, {
    user_id,
    product_id,
    payment_method = "polens",
    amount_polens = null,
    amount_cents = null,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_manifestations
         (user_id, product_id, acquired_at, expires_at, is_active, payment_method, amount_polens, amount_cents)
       VALUES ($1, $2, NOW(), NULL, FALSE, $3, $4, $5)
       ON CONFLICT (user_id, product_id) DO NOTHING
       RETURNING *`,
      [user_id, product_id, payment_method, amount_polens, amount_cents]
    );
    return rows[0] || null;
  }

  // Aplica uma manifestação desbloqueada no headcard (1 ativa por user).
  static async setActiveManifestation(conn, userId, productId) {
    await conn.query(
      `UPDATE public.user_manifestations
          SET is_active = FALSE
        WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );
    const { rows } = await conn.query(
      `UPDATE public.user_manifestations
          SET is_active = TRUE
        WHERE user_id = $1 AND product_id = $2
        RETURNING *`,
      [userId, productId]
    );
    return rows[0] || null;
  }

  static async reserveStock(conn, productId) {
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - 1 END,
              updated_at = NOW()
        WHERE id = $1
          AND is_active = TRUE
          AND (stock IS NULL OR stock > 0)
        RETURNING *`,
      [productId]
    );
    return rows[0] || null;
  }

  static async createUserManifestation(conn, data) {
    const { rows } = await conn.query(
      `INSERT INTO public.user_manifestations
         (user_id, product_id, acquired_at, expires_at, is_active, payment_method,
          stripe_session_id, stripe_payment_intent, amount_cents, amount_polens)
       VALUES ($1,$2,NOW(),NOW() + ($3::int * INTERVAL '1 day'),TRUE,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        data.user_id,
        data.product_id,
        data.duration_days,
        data.payment_method,
        data.stripe_session_id || null,
        data.stripe_payment_intent || null,
        data.amount_cents ?? null,
        data.amount_polens ?? null,
      ]
    );
    return rows[0];
  }

  static async getUserManifestationByStripeSession(conn, sessionId) {
    const { rows } = await conn.query(
      `SELECT * FROM public.user_manifestations WHERE stripe_session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return rows[0] || null;
  }

  static async getOwnedProfileForApply(conn, { userId, profileId }) {
    const { rows } = await conn.query(
      `SELECT id_profile, id_user, display_name, is_clan, deleted_at
         FROM public.tb_profile
        WHERE id_profile = $1
          AND id_user = $2
          AND deleted_at IS NULL
        LIMIT 1`,
      [profileId, userId]
    );
    return rows[0] || null;
  }

  static async setProfileApplied(conn, { userManifestationId, profileId, enabled }) {
    if (enabled) {
      const { rows } = await conn.query(
        `INSERT INTO public.user_manifestation_profile_apply (user_manifestation_id, profile_id)
         VALUES ($1, $2)
         ON CONFLICT (user_manifestation_id, profile_id) DO UPDATE
            SET enabled_at = NOW()
         RETURNING *`,
        [userManifestationId, profileId]
      );
      return rows[0] || null;
    }
    await conn.query(
      `DELETE FROM public.user_manifestation_profile_apply
        WHERE user_manifestation_id = $1 AND profile_id = $2`,
      [userManifestationId, profileId]
    );
    return { profile_id: profileId, enabled: false };
  }
}

module.exports = ManifestationStorage;
