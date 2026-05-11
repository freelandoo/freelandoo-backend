// src/storages/CourseProgressStorage.js
// SQL puro para public.course_lesson_progress (Slice 13).

class CourseProgressStorage {
  static async getActiveEnrollment(conn, userId, courseId) {
    const { rows } = await conn.query(
      `SELECT id, course_id, user_id, status, enrolled_at
         FROM public.course_enrollments
        WHERE user_id = $1
          AND course_id = $2
          AND status = 'active'
        LIMIT 1`,
      [userId, courseId],
    );
    return rows[0] || null;
  }

  static async getLessonForProgress(conn, courseId, lessonId) {
    const { rows } = await conn.query(
      `SELECT
         l.id,
         l.course_id,
         l.module_id,
         l.title,
         l.status,
         m.status AS module_status,
         c.status AS course_status
         FROM public.course_lessons l
         INNER JOIN public.course_modules m
           ON m.id = l.module_id
          AND m.course_id = l.course_id
         INNER JOIN public.courses c
           ON c.id = l.course_id
        WHERE l.id = $1
          AND l.course_id = $2
        LIMIT 1`,
      [lessonId, courseId],
    );
    return rows[0] || null;
  }

  static async upsertLessonProgress(conn, { userId, courseId, lessonId, completed }) {
    const { rows } = await conn.query(
      `INSERT INTO public.course_lesson_progress
         (course_id, lesson_id, user_id, completed_at)
       VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN NOW() ELSE NULL END)
       ON CONFLICT (lesson_id, user_id)
       DO UPDATE SET
         course_id = EXCLUDED.course_id,
         completed_at = CASE WHEN $4::boolean THEN COALESCE(public.course_lesson_progress.completed_at, NOW()) ELSE NULL END
       RETURNING id, course_id, lesson_id, user_id, completed_at, created_at, updated_at`,
      [courseId, lessonId, userId, !!completed],
    );
    return rows[0] || null;
  }

  static async getCourseProgressSummary(conn, userId, courseId) {
    const { rows } = await conn.query(
      `WITH published_lessons AS (
         SELECT l.id
           FROM public.course_lessons l
           INNER JOIN public.course_modules m
             ON m.id = l.module_id
            AND m.course_id = l.course_id
           INNER JOIN public.courses c
             ON c.id = l.course_id
          WHERE l.course_id = $2
            AND c.status = 'published'
            AND m.status = 'published'
            AND l.status = 'published'
       ),
       completed_lessons AS (
         SELECT DISTINCT clp.lesson_id
           FROM public.course_lesson_progress clp
           INNER JOIN published_lessons pl ON pl.id = clp.lesson_id
          WHERE clp.user_id = $1
            AND clp.course_id = $2
            AND clp.completed_at IS NOT NULL
       )
       SELECT
         (SELECT COUNT(*) FROM published_lessons)::int AS lessons_count,
         (SELECT COUNT(*) FROM completed_lessons)::int AS completed_lessons_count`,
      [userId, courseId],
    );
    const row = rows[0] || { lessons_count: 0, completed_lessons_count: 0 };
    const lessonsCount = Number(row.lessons_count || 0);
    const completedLessonsCount = Number(row.completed_lessons_count || 0);
    return {
      lessons_count: lessonsCount,
      completed_lessons_count: completedLessonsCount,
      progress_percent:
        lessonsCount > 0
          ? Math.round((completedLessonsCount / lessonsCount) * 100)
          : 0,
    };
  }

  static async listLessonProgressByCourse(conn, userId, courseId) {
    const { rows } = await conn.query(
      `SELECT
         l.id AS lesson_id,
         l.module_id,
         l.title,
         l.position,
         l.status,
         clp.completed_at
       FROM public.course_lessons l
       INNER JOIN public.course_modules m
         ON m.id = l.module_id
        AND m.course_id = l.course_id
       INNER JOIN public.courses c
         ON c.id = l.course_id
       LEFT JOIN public.course_lesson_progress clp
         ON clp.lesson_id = l.id
        AND clp.user_id = $1
       WHERE l.course_id = $2
         AND c.status = 'published'
         AND m.status = 'published'
         AND l.status = 'published'
       ORDER BY l.module_id, l.position ASC, l.created_at ASC`,
      [userId, courseId],
    );
    return rows;
  }
}

module.exports = CourseProgressStorage;
