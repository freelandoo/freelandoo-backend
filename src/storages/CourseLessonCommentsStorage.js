// src/storages/CourseLessonCommentsStorage.js
// SQL puro para public.course_lesson_comments (Slice 15).

class CourseLessonCommentsStorage {
  static async listByLesson(conn, lessonId) {
    const { rows } = await conn.query(
      `SELECT
         c.id, c.course_id, c.lesson_id, c.user_id, c.body, c.status,
         c.created_at, c.updated_at,
         u.nome AS user_name,
         u.avatar AS user_avatar,
         p.display_name AS profile_display_name,
         p.avatar_url AS profile_avatar_url
       FROM public.course_lesson_comments c
       INNER JOIN public.tb_user u ON u.id_user = c.user_id
       LEFT JOIN LATERAL (
         SELECT display_name, avatar_url
           FROM public.tb_profile
          WHERE id_user = c.user_id
            AND is_active = true
          ORDER BY created_at ASC
          LIMIT 1
       ) p ON true
       WHERE c.lesson_id = $1
         AND c.status = 'active'
       ORDER BY c.created_at DESC`,
      [lessonId],
    );
    return rows;
  }

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT id, course_id, lesson_id, user_id, body, status, created_at, updated_at
         FROM public.course_lesson_comments
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  }

  static async create(conn, { courseId, lessonId, userId, body }) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_lesson_comments
         (course_id, lesson_id, user_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [courseId, lessonId, userId, body],
    );
    return rows[0];
  }

  static async softDelete(conn, id) {
    const { rows } = await conn.query(
      `UPDATE public.course_lesson_comments
          SET status = 'deleted'
        WHERE id = $1
        RETURNING *`,
      [id],
    );
    return rows[0] || null;
  }
}

module.exports = CourseLessonCommentsStorage;
