// src/storages/CoursePlayerStorage.js
// Leituras do player do aluno (Slice 14).

class CoursePlayerStorage {
  static async getCourseForStudent(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT
         c.id, c.owner_user_id, c.profile_id, c.title, c.slug,
         c.short_description, c.description, c.cover_url, c.price_cents,
         c.status, c.published_at, c.created_at, c.updated_at,
         p.display_name AS profile_display_name
       FROM public.courses c
       LEFT JOIN public.tb_profile p ON p.id_profile = c.profile_id
       WHERE c.id = $1
         AND c.status = 'published'
       LIMIT 1`,
      [courseId],
    );
    return rows[0] || null;
  }

  static async listPublishedModules(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT id, course_id, title, description, banner_url, position, status,
              created_at, updated_at
         FROM public.course_modules
        WHERE course_id = $1
          AND status = 'published'
        ORDER BY position ASC, created_at ASC`,
      [courseId],
    );
    return rows;
  }

  static async listPublishedLessonsForUser(conn, courseId, userId) {
    const { rows } = await conn.query(
      `SELECT
         l.id, l.course_id, l.module_id, l.title, l.description, l.cover_url,
         l.position, l.status, l.video_status, l.original_video_url,
         l.processed_video_url, l.thumbnail_url, l.duration_seconds,
         l.created_at, l.updated_at, clp.completed_at
       FROM public.course_lessons l
       INNER JOIN public.course_modules m
         ON m.id = l.module_id
        AND m.course_id = l.course_id
       LEFT JOIN public.course_lesson_progress clp
         ON clp.lesson_id = l.id
        AND clp.user_id = $2
       WHERE l.course_id = $1
         AND m.status = 'published'
         AND l.status = 'published'
       ORDER BY l.module_id, l.position ASC, l.created_at ASC`,
      [courseId, userId],
    );
    return rows;
  }
}

module.exports = CoursePlayerStorage;
