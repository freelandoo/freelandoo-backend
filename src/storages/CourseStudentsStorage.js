// src/storages/CourseStudentsStorage.js
// SQL puro para public.course_enrollments (Slice 11).

class CourseStudentsStorage {
  static async getSummaryByCourse(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_students_count,
         COUNT(*)::int AS total_enrollments_count,
         COALESCE(SUM(amount_paid_cents) FILTER (WHERE status = 'active'), 0)::int
           AS active_revenue_cents,
         COALESCE(SUM(amount_paid_cents), 0)::int AS gross_revenue_cents,
         MAX(enrolled_at) AS last_enrolled_at
       FROM public.course_enrollments
       WHERE course_id = $1`,
      [courseId],
    );
    return rows[0] || {
      active_students_count: 0,
      total_enrollments_count: 0,
      active_revenue_cents: 0,
      gross_revenue_cents: 0,
      last_enrolled_at: null,
    };
  }

  static async listByCourse(conn, courseId) {
    const { rows } = await conn.query(
      `SELECT
         ce.id,
         ce.course_id,
         ce.user_id,
         ce.order_id,
         ce.amount_paid_cents,
         ce.currency,
         ce.status,
         ce.enrolled_at,
         ce.created_at,
         ce.updated_at,
         u.nome AS student_name,
         u.email AS student_email,
         u.avatar AS student_avatar,
         p.display_name AS profile_display_name,
         p.avatar_url AS profile_avatar_url
       FROM public.course_enrollments ce
       INNER JOIN public.tb_user u ON u.id_user = ce.user_id
       LEFT JOIN LATERAL (
         SELECT display_name, avatar_url
           FROM public.tb_profile
          WHERE id_user = ce.user_id
            AND is_active = true
          ORDER BY created_at ASC
          LIMIT 1
       ) p ON true
       WHERE ce.course_id = $1
       ORDER BY ce.enrolled_at DESC, ce.created_at DESC`,
      [courseId],
    );
    return rows;
  }
}

module.exports = CourseStudentsStorage;
