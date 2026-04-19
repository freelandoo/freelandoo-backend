class MachineStorage {
  static async listMachines(conn, { include_inactive = false } = {}) {
    const { rows } = await conn.query(
      `
      SELECT
        id_machine,
        slug,
        name,
        display_order,
        color_from,
        color_to,
        color_glow,
        color_ring,
        color_accent,
        color_text,
        is_active
      FROM public.tb_machine
      WHERE ($1::boolean = TRUE) OR (is_active = TRUE)
      ORDER BY display_order, name
      `,
      [include_inactive]
    );
    return rows;
  }

  static async getMachineById(conn, id_machine) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM public.tb_machine
      WHERE id_machine = $1
      LIMIT 1
      `,
      [id_machine]
    );
    return rows[0] || null;
  }

  static async getMachineBySlug(conn, slug) {
    const { rows } = await conn.query(
      `
      SELECT *
      FROM public.tb_machine
      WHERE slug = $1
      LIMIT 1
      `,
      [slug]
    );
    return rows[0] || null;
  }

  static async listCategoriesByMachine(
    conn,
    id_machine,
    { include_inactive = false } = {}
  ) {
    const { rows } = await conn.query(
      `
      SELECT id_category, desc_category, id_machine, is_active
      FROM public.tb_category
      WHERE id_machine = $1
        AND (($2::boolean = TRUE) OR (is_active = TRUE))
      ORDER BY desc_category
      `,
      [id_machine, include_inactive]
    );
    return rows;
  }

  static async listMachinesWithCategories(
    conn,
    { include_inactive = false } = {}
  ) {
    const { rows } = await conn.query(
      `
      SELECT
        m.id_machine,
        m.slug,
        m.name,
        m.display_order,
        m.color_from,
        m.color_to,
        m.color_glow,
        m.color_ring,
        m.color_accent,
        m.color_text,
        m.is_active,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id_category', c.id_category,
              'desc_category', c.desc_category,
              'is_active', c.is_active
            )
            ORDER BY c.desc_category
          ) FILTER (WHERE c.id_category IS NOT NULL),
          '[]'::jsonb
        ) AS categories
      FROM public.tb_machine m
      LEFT JOIN public.tb_category c
        ON c.id_machine = m.id_machine
       AND (($1::boolean = TRUE) OR (c.is_active = TRUE))
      WHERE ($1::boolean = TRUE) OR (m.is_active = TRUE)
      GROUP BY m.id_machine
      ORDER BY m.display_order, m.name
      `,
      [include_inactive]
    );
    return rows;
  }

  // ─────────────────── Admin mutations ───────────────────
  static async updateMachineStatus(conn, { id_machine, is_active }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_machine
         SET is_active = $2,
             updated_at = NOW()
       WHERE id_machine = $1
      RETURNING *
      `,
      [id_machine, is_active]
    );
    return rows[0] || null;
  }

  static async updateMachine(conn, { id_machine, fields }) {
    const allowed = [
      "name",
      "display_order",
      "color_from",
      "color_to",
      "color_glow",
      "color_ring",
      "color_accent",
      "color_text",
    ];
    const sets = [];
    const values = [id_machine];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = $${++i}`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) return await this.getMachineById(conn, id_machine);
    sets.push("updated_at = NOW()");
    const { rows } = await conn.query(
      `
      UPDATE public.tb_machine
         SET ${sets.join(", ")}
       WHERE id_machine = $1
      RETURNING *
      `,
      values
    );
    return rows[0] || null;
  }

  static async addCategoryToMachine(conn, { id_machine, desc_category }) {
    const existing = await conn.query(
      `SELECT id_category, id_machine, is_active
         FROM public.tb_category
        WHERE LOWER(desc_category) = LOWER($1)
        LIMIT 1`,
      [desc_category]
    );
    if (existing.rows[0]) {
      const { rows } = await conn.query(
        `
        UPDATE public.tb_category
           SET id_machine = $2,
               is_active  = TRUE
         WHERE id_category = $1
        RETURNING *
        `,
        [existing.rows[0].id_category, id_machine]
      );
      return { row: rows[0], created: false };
    }
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_category (desc_category, id_machine, is_active)
      VALUES ($1, $2, TRUE)
      RETURNING *
      `,
      [desc_category, id_machine]
    );
    return { row: rows[0], created: true };
  }

  static async updateCategory(conn, { id_category, fields }) {
    const allowed = ["desc_category", "is_active", "id_machine"];
    const sets = [];
    const values = [id_category];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = $${++i}`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) {
      const { rows } = await conn.query(
        `SELECT * FROM public.tb_category WHERE id_category = $1`,
        [id_category]
      );
      return rows[0] || null;
    }
    const { rows } = await conn.query(
      `
      UPDATE public.tb_category
         SET ${sets.join(", ")}
       WHERE id_category = $1
      RETURNING *
      `,
      values
    );
    return rows[0] || null;
  }

  static async getCategoryById(conn, id_category) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_category WHERE id_category = $1 LIMIT 1`,
      [id_category]
    );
    return rows[0] || null;
  }

  // ─────────────────── Admin audit ───────────────────
  static async writeAudit(
    conn,
    {
      entity,
      entity_id,
      action,
      before_state = null,
      after_state = null,
      reason = null,
      actor_user_id = null,
    }
  ) {
    await conn.query(
      `
      INSERT INTO public.tb_admin_audit_log
        (entity, entity_id, action, before_state, after_state, reason, actor_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [entity, String(entity_id), action, before_state, after_state, reason, actor_user_id]
    );
  }
}

module.exports = MachineStorage;
