// src/services/CourseStudentsService.js
// Área admin "Alunos / Vendas" (Slice 11).

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseStudentsStorage = require("../storages/CourseStudentsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseStudentsService");

async function ensureCourseOwner(conn, courseId, userId) {
  if (!courseId) return { error: "ID do curso inválido" };
  const course = await CoursesStorage.getById(conn, courseId);
  if (!course) return { error: "Curso não encontrado" };
  if (course.owner_user_id !== userId) {
    return { error: "Sem permissão para acessar este curso" };
  }
  return { course };
}

function publicStudentShape(row) {
  return {
    id: row.id,
    course_id: row.course_id,
    user_id: row.user_id,
    order_id: row.order_id || null,
    amount_paid_cents: Number(row.amount_paid_cents || 0),
    currency: row.currency || "BRL",
    status: row.status,
    enrolled_at: row.enrolled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    student_name: row.profile_display_name || row.student_name || "Aluno",
    student_email: row.student_email || null,
    student_avatar: row.profile_avatar_url || row.student_avatar || null,
  };
}

function publicSummaryShape(row) {
  return {
    active_students_count: Number(row?.active_students_count || 0),
    total_enrollments_count: Number(row?.total_enrollments_count || 0),
    active_revenue_cents: Number(row?.active_revenue_cents || 0),
    gross_revenue_cents: Number(row?.gross_revenue_cents || 0),
    last_enrolled_at: row?.last_enrolled_at || null,
  };
}

function publicPurchasedCourseShape(row) {
  const publishedCount = Number(row.published_lessons_count || 0);
  const completedCount = Number(row.completed_lessons_count || 0);
  return {
    enrollment_id: row.enrollment_id,
    enrolled_at: row.enrolled_at,
    amount_paid_cents: Number(row.amount_paid_cents || 0),
    currency: row.currency || "BRL",
    progress_percent:
      publishedCount > 0 ? Math.round((completedCount / publishedCount) * 100) : 0,
    completed_lessons_count: completedCount,
    published_lessons_count: publishedCount,
    id: row.id,
    owner_user_id: row.owner_user_id,
    profile_id: row.profile_id || null,
    profile_display_name: row.profile_display_name || null,
    creator_name: row.profile_display_name || row.owner_name || null,
    creator_avatar: row.profile_avatar_url || row.owner_avatar || null,
    title: row.title,
    slug: row.slug,
    short_description: row.short_description,
    description: row.description,
    cover_url: row.cover_url,
    price_cents: row.price_cents,
    status: row.status,
    feed_post_id: row.feed_post_id || null,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    modules_count: row.modules_count ?? 0,
    lessons_count: row.lessons_count ?? 0,
    students_count: 0,
  };
}

class CourseStudentsService {
  static async listPurchased(user) {
    return runWithLogs(
      log,
      "listPurchased",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const rows = await CourseStudentsStorage.listPurchasedByUser(
          pool,
          user.id_user,
        );
        return { courses: rows.map(publicPurchasedCourseShape) };
      },
    );
  }

  static async list(user, courseId) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureCourseOwner(pool, courseId, user.id_user);
        if (own.error) return own;

        const [summary, rows] = await Promise.all([
          CourseStudentsStorage.getSummaryByCourse(pool, courseId),
          CourseStudentsStorage.listByCourse(pool, courseId),
        ]);

        return {
          summary: publicSummaryShape(summary),
          students: rows.map(publicStudentShape),
        };
      },
    );
  }
}

module.exports = CourseStudentsService;
