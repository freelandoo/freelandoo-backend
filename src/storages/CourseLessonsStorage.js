// src/storages/CourseLessonsStorage.js
// SQL puro para public.course_lessons (migration 044).

class CourseLessonsStorage {
  static async listByModule(conn, moduleId) {
    const { rows } = await conn.query(
      `SELECT
         id, course_id, module_id, title, description, position, status,
         video_status, original_video_url, processed_video_url,
         thumbnail_url, duration_seconds, created_at, updated_at
       FROM public.course_lessons
       WHERE module_id = $1
       ORDER BY position ASC, created_at ASC`,
      [moduleId],
    );
    return rows;
  }

  static async listByCourse(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT
         id, course_id, module_id, title, description, position, status,
         video_status, original_video_url, processed_video_url,
         thumbnail_url, duration_seconds, created_at, updated_at
       FROM public.course_lessons
       WHERE course_id = $1
       ORDER BY module_id, position ASC`,
      [courseId],
    );
    return rows;
  }

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT
         id, course_id, module_id, title, description, position, status,
         video_status, original_video_url, processed_video_url,
         thumbnail_url, duration_seconds, created_at, updated_at
       FROM public.course_lessons
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  }

  static async getNextPosition(conn, moduleId) {
    const { rows } = await conn.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM public.course_lessons
        WHERE module_id = $1`,
      [moduleId],
    );
    return rows[0]?.next || 0;
  }

  static async create(
    conn,
    {
      courseId,
      moduleId,
      title,
      description = null,
      position,
      status = "draft",
    },
  ) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_lessons
         (course_id, module_id, title, description, position, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [courseId, moduleId, title, description, position, status],
    );
    return rows[0];
  }

  static async updateById(conn, id, patch) {
    const allowed = new Set([
      "title",
      "description",
      "position",
      "status",
      "video_status",
      "original_video_url",
      "processed_video_url",
      "thumbnail_url",
      "duration_seconds",
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
      `UPDATE public.course_lessons
         SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );
    return rows[0] || null;
  }

  static async deleteById(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.course_lessons WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }

  /**
   * Reordenação atômica das aulas DE UM ÚNICO MÓDULO.
   * Mesmo padrão de shift +1000000 usado em CourseModulesStorage.setOrder
   * para evitar colisão no UNIQUE (module_id, position).
   */
  static async setOrder(conn, moduleId, orderedIds) {
    await conn.query("BEGIN");
    try {
      await conn.query(
        `UPDATE public.course_lessons
            SET position = position + 1000000
          WHERE module_id = $1`,
        [moduleId],
      );

      for (let i = 0; i < orderedIds.length; i += 1) {
        const id = orderedIds[i];
        await conn.query(
          `UPDATE public.course_lessons
              SET position = $1
            WHERE id = $2 AND module_id = $3`,
          [i, id, moduleId],
        );
      }

      const { rows: leftovers } = await conn.query(
        `SELECT id FROM public.course_lessons
          WHERE module_id = $1 AND position >= 1000000
          ORDER BY position ASC`,
        [moduleId],
      );
      let nextPos = orderedIds.length;
      for (const row of leftovers) {
        await conn.query(
          `UPDATE public.course_lessons SET position = $1 WHERE id = $2`,
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
  // Helpers de agregação usados por outros services
  // -------------------------------------------------------------------------

  /** Mapa moduleId -> count, para a lista de módulos da engrenagem. */
  static async countsByModuleIds(conn, moduleIds) {
    if (!Array.isArray(moduleIds) || !moduleIds.length) return {};
    const { rows } = await conn.query(
      `SELECT module_id, COUNT(*)::int AS c
         FROM public.course_lessons
        WHERE module_id = ANY($1::uuid[])
        GROUP BY module_id`,
      [moduleIds],
    );
    const map = {};
    for (const row of rows) map[row.module_id] = row.c;
    return map;
  }
}

module.exports = CourseLessonsStorage;
