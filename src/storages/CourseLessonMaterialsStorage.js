// src/storages/CourseLessonMaterialsStorage.js
// SQL puro para public.course_lesson_materials (migration 045).

class CourseLessonMaterialsStorage {
  static async listByLesson(conn, lessonId) {
    const { rows } = await conn.query(
      `SELECT
         id, lesson_id, kind, title,
         file_url, file_size_bytes, mime,
         link_url, position, created_at, updated_at
       FROM public.course_lesson_materials
       WHERE lesson_id = $1
       ORDER BY position ASC, created_at ASC`,
      [lessonId],
    );
    return rows;
  }

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT
         id, lesson_id, kind, title,
         file_url, file_size_bytes, mime,
         link_url, position, created_at, updated_at
       FROM public.course_lesson_materials
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  }

  static async getNextPosition(conn, lessonId) {
    const { rows } = await conn.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM public.course_lesson_materials
        WHERE lesson_id = $1`,
      [lessonId],
    );
    return rows[0]?.next || 0;
  }

  static async createFile(
    conn,
    { lessonId, title, fileUrl, fileSizeBytes, mime, position },
  ) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_lesson_materials
         (lesson_id, kind, title, file_url, file_size_bytes, mime, position)
       VALUES ($1, 'file', $2, $3, $4, $5, $6)
       RETURNING *`,
      [lessonId, title, fileUrl, fileSizeBytes, mime, position],
    );
    return rows[0];
  }

  static async createLink(conn, { lessonId, title, linkUrl, position }) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_lesson_materials
         (lesson_id, kind, title, link_url, position)
       VALUES ($1, 'link', $2, $3, $4)
       RETURNING *`,
      [lessonId, title, linkUrl, position],
    );
    return rows[0];
  }

  static async updateById(conn, id, patch) {
    // Só permitimos editar título e (para links) link_url. Para trocar
    // o arquivo, o user deve deletar e recriar.
    const allowed = new Set(["title", "link_url"]);
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
      `UPDATE public.course_lesson_materials
         SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );
    return rows[0] || null;
  }

  static async deleteById(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.course_lesson_materials WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }

  /**
   * Reordenação atômica usando o shift +1000000 (mesmo padrão de modules/lessons).
   */
  static async setOrder(conn, lessonId, orderedIds) {
    await conn.query("BEGIN");
    try {
      await conn.query(
        `UPDATE public.course_lesson_materials
            SET position = position + 1000000
          WHERE lesson_id = $1`,
        [lessonId],
      );

      for (let i = 0; i < orderedIds.length; i += 1) {
        const id = orderedIds[i];
        await conn.query(
          `UPDATE public.course_lesson_materials
              SET position = $1
            WHERE id = $2 AND lesson_id = $3`,
          [i, id, lessonId],
        );
      }

      const { rows: leftovers } = await conn.query(
        `SELECT id FROM public.course_lesson_materials
          WHERE lesson_id = $1 AND position >= 1000000
          ORDER BY position ASC`,
        [lessonId],
      );
      let nextPos = orderedIds.length;
      for (const row of leftovers) {
        await conn.query(
          `UPDATE public.course_lesson_materials SET position = $1 WHERE id = $2`,
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
}

module.exports = CourseLessonMaterialsStorage;
