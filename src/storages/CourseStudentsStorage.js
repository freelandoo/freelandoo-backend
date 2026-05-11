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

  static async listPurchasedByUser(conn, userId) {
    const { rows } = await conn.query(
      `SELECT
         ce.id AS enrollment_id,
         ce.course_id,
         ce.user_id,
         ce.order_id,
         ce.amount_paid_cents,
         ce.currency,
         ce.status AS enrollment_status,
         ce.enrolled_at,
         c.id,
         c.owner_user_id,
         c.profile_id,
         c.title,
         c.slug,
         c.short_description,
         c.description,
         c.cover_url,
         c.price_cents,
         c.status,
         c.feed_post_id,
         c.published_at,
         c.created_at,
         c.updated_at,
         owner.nome AS owner_name,
         owner.avatar AS owner_avatar,
         p.display_name AS profile_display_name,
         p.avatar_url AS profile_avatar_url,
         COALESCE(mc.modules_count, 0)::int AS modules_count,
         COALESCE(lc.lessons_count, 0)::int AS lessons_count
       FROM public.course_enrollments ce
       INNER JOIN public.courses c ON c.id = ce.course_id
       INNER JOIN public.tb_user owner ON owner.id_user = c.owner_user_id
       LEFT JOIN public.tb_profile p ON p.id_profile = c.profile_id
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS modules_count
           FROM public.course_modules
          GROUP BY course_id
       ) mc ON mc.course_id = c.id
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS lessons_count
           FROM public.course_lessons
          GROUP BY course_id
       ) lc ON lc.course_id = c.id
       WHERE ce.user_id = $1
         AND ce.status = 'active'
       ORDER BY ce.enrolled_at DESC, ce.created_at DESC`,
      [userId],
    );
    return rows;
  }
}

module.exports = CourseStudentsStorage;
