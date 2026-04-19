// src/storages/RolesStorage.js
const pool = require("../databases");

class RolesStorage {
  static async list({ active = "true" } = {}) {
    let where = "WHERE 1=1";

    const a = String(active).toLowerCase();
    if (a === "true") where += " AND is_active = TRUE";
    else if (a === "false") where += " AND is_active = FALSE";
    // "all" -> sem filtro

    const { rows } = await pool.query(
      `
      SELECT id_role, desc_role, is_active, created_by, created_at, updated_by, updated_at
      FROM tb_role
      ${where}
      ORDER BY desc_role ASC
      `
    );

    return rows;
  }

  static async getById(id_role) {
    const { rows } = await pool.query(
      `
      SELECT id_role, desc_role, is_active, created_by, created_at, updated_by, updated_at
      FROM tb_role
      WHERE id_role = $1
      LIMIT 1
      `,
      [id_role]
    );
    return rows[0] || null;
  }

  static async getByDesc(desc_role) {
    const { rows } = await pool.query(
      `SELECT id_role, desc_role FROM tb_role WHERE desc_role = $1 LIMIT 1`,
      [desc_role]
    );
    return rows[0] || null;
  }

  static async create({ desc_role, created_by }) {
    const { rows } = await pool.query(
      `
      INSERT INTO tb_role (id_role, desc_role, created_by, created_at, is_active)
      VALUES (gen_random_uuid(), $1, $2, NOW(), TRUE)
      RETURNING id_role, desc_role, is_active, created_by, created_at, updated_by, updated_at
      `,
      [desc_role, created_by]
    );
    return rows[0];
  }

  static async update({ id_role, desc_role, is_active, updated_by }) {
    // monta update dinâmico
    const sets = [];
    const params = [];
    let i = 1;

    if (desc_role !== undefined) {
      sets.push(`desc_role = $${i++}`);
      params.push(desc_role);
    }
    if (is_active !== undefined) {
      sets.push(`is_active = $${i++}`);
      params.push(is_active);
    }

    sets.push(`updated_by = $${i++}`);
    params.push(updated_by);

    sets.push(`updated_at = NOW()`);

    params.push(id_role);

    const { rows } = await pool.query(
      `
      UPDATE tb_role
      SET ${sets.join(", ")}
      WHERE id_role = $${i}
      RETURNING id_role, desc_role, is_active, created_by, created_at, updated_by, updated_at
      `,
      params
    );

    return rows[0] || null;
  }

  static async softDelete({ id_role, updated_by }) {
    const { rows } = await pool.query(
      `
      UPDATE tb_role
      SET is_active = FALSE,
          updated_by = $1,
          updated_at = NOW()
      WHERE id_role = $2
      RETURNING id_role, desc_role, is_active, created_by, created_at, updated_by, updated_at
      `,
      [updated_by, id_role]
    );
    return rows[0] || null;
  }
}

module.exports = RolesStorage;
