// src/storages/CourseModulesStorage.js
// SQL puro para public.course_modules (migration 043).

class CourseModulesStorage {
  static async listByCourse(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT
         m.id,
         m.course_id,
         m.title,
         m.description,
         m.banner_url,
         m.position,
         m.status,
         m.created_at,
         m.updated_at,
         COALESCE(lc.lessons_count, 0)::int AS lessons_count
       FROM public.course_modules m
       LEFT JOIN (
         SELECT module_id, COUNT(*) AS lessons_count
           FROM public.course_lessons
          WHERE module_id IN (
            SELECT id FROM public.course_modules WHERE course_id = $1
          )
          GROUP BY module_id
       ) lc ON lc.module_id = m.id
       WHERE m.course_id = $1
       ORDER BY m.position ASC, m.created_at ASC`,
      [courseId],
    );
    return rows;
  }

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT id, course_id, title, description, banner_url, position, status,
              created_at, updated_at
       FROM public.course_modules
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  }

  static async countByCourse(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS c FROM public.course_modules WHERE course_id = $1`,
      [courseId],
    );
    return rows[0]?.c || 0;
  }

  static async getNextPosition(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM public.course_modules
        WHERE course_id = $1`,
      [courseId],
    );
    return rows[0]?.next || 0;
  }

  static async create(
    conn,
    {
      courseId,
      title,
      description = null,
      bannerUrl = null,
      position,
      status = "draft",
    },
  ) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_modules
         (course_id, title, description, banner_url, position, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [courseId, title, description, bannerUrl, position, status],
    );
    return rows[0];
  }

  static async updateById(conn, id, patch) {
    const allowed = new Set([
      "title",
      "description",
      "banner_url",
      "position",
      "status",
    ]);
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(patch || {})) {
      if (!allowed.has(key)) continue;
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }
    if (!sets.length) return this.getById(conn, id);
    params.push(id);
    const { rows } = await conn.query(
      `UPDATE public.course_modules
         SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );
    return rows[0] || null;
  }

  static async deleteById(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.course_modules WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }

  /**
   * Reordenação atômica: recebe um array de IDs na ordem desejada e seta
   * `position` = 0..N-1 para cada um. Faz tudo dentro de uma transação,
   * usando um shift temporário para evitar colisão no índice UNIQUE
   * (course_id, position).
   */
  static async setOrder(conn, courseId, orderedIds) {
    await conn.query("BEGIN");
    try {
      // Step 1: desloca todos os módulos do curso para faixa "alta" temporária
      // (evita colisão no UNIQUE (course_id, position) durante o reorder).
      await conn.query(
        `UPDATE public.course_modules
            SET position = position + 1000000
          WHERE course_id = $1`,
        [courseId],
      );

      // Step 2: aplica as novas posições.
      for (let i = 0; i < orderedIds.length; i += 1) {
        const id = orderedIds[i];
        await conn.query(
          `UPDATE public.course_modules
              SET position = $1
            WHERE id = $2 AND course_id = $3`,
          [i, id, courseId],
        );
      }

      // Step 3: compacta qualquer módulo que tenha ficado na faixa alta
      // (caso o cliente tenha esquecido algum id). Reposiciona no final.
      const { rows: leftovers } = await conn.query(
        `SELECT id FROM public.course_modules
          WHERE course_id = $1 AND position >= 1000000
          ORDER BY position ASC`,
        [courseId],
      );
      let nextPos = orderedIds.length;
      for (const row of leftovers) {
        await conn.query(
          `UPDATE public.course_modules SET position = $1 WHERE id = $2`,
          [nextPos, row.id],
        );
        nextPos += 1;
      }

      await conn.query("COMMIT");
    } catch (err) {
      await conn.query("ROLLBACK");
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers usados por outros services (contagens agregadas)
  // -------------------------------------------------------------------------

  static async getCountsByCourseIds(conn, courseIds) {
    if (!Array.isArray(courseIds) || !courseIds.length) return {};
    const { rows } = await conn.query(
      `SELECT course_id, COUNT(*)::int AS c
         FROM public.course_modules
        WHERE course_id = ANY($1::uuid[])
        GROUP BY course_id`,
      [courseIds],
    );
    const map = {};
    for (const row of rows) map[row.course_id] = row.c;
    return map;
  }
}

module.exports = CourseModulesStorage;
