// src/services/CourseProgressService.js
// Progresso do aluno em cursos comprados (Slice 13).

const pool = require("../databases");
const CourseProgressStorage = require("../storages/CourseProgressStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseProgressService");

function publicProgressRow(row) {
  return {
    lesson_id: row.lesson_id,
    module_id: row.module_id,
    title: row.title,
    position: row.position,
    status: row.status,
    completed_at: row.completed_at || null,
    is_completed: !!row.completed_at,
  };
}

async function ensureActiveEnrollment(conn, userId, courseId) {
  if (!courseId) return { error: "ID do curso inválido" };
  const enrollment = await CourseProgressStorage.getActiveEnrollment(
    conn,
    userId,
    courseId,
  );
  if (!enrollment) return { error: "Matrícula ativa não encontrada" };
  return { enrollment };
}

class CourseProgressService {
  static async getCourseProgress(user, courseId) {
    return runWithLogs(
      log,
      "getCourseProgress",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureActiveEnrollment(pool, user.id_user, courseId);
        if (own.error) return own;
        const [summary, rows] = await Promise.all([
          CourseProgressStorage.getCourseProgressSummary(
            pool,
            user.id_user,
            courseId,
          ),
          CourseProgressStorage.listLessonProgressByCourse(
            pool,
            user.id_user,
            courseId,
          ),
        ]);
        return {
          summary,
          lessons: rows.map(publicProgressRow),
        };
      },
    );
  }

  static async setLessonCompleted(user, courseId, lessonId, body = {}) {
    return runWithLogs(
      log,
      "setLessonCompleted",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!lessonId) return { error: "ID da aula inválido" };
        const completed = body.completed !== false;

        const client = await pool.connect();
        try {
          const own = await ensureActiveEnrollment(client, user.id_user, courseId);
          if (own.error) return own;

          const lesson = await CourseProgressStorage.getLessonForProgress(
            client,
            courseId,
            lessonId,
          );
          if (!lesson) return { error: "Aula não encontrada" };
          if (lesson.course_status !== "published") {
            return { error: "Curso não publicado" };
          }
          if (lesson.module_status !== "published") {
            return { error: "Módulo não publicado" };
          }
          if (lesson.status !== "published") {
            return { error: "Apenas aulas publicadas podem receber progresso" };
          }

          const progress = await CourseProgressStorage.upsertLessonProgress(
            client,
            {
              userId: user.id_user,
              courseId,
              lessonId,
              completed,
            },
          );
          const summary = await CourseProgressStorage.getCourseProgressSummary(
            client,
            user.id_user,
            courseId,
          );
          return {
            progress: {
              id: progress.id,
              course_id: progress.course_id,
              lesson_id: progress.lesson_id,
              user_id: progress.user_id,
              completed_at: progress.completed_at,
              is_completed: !!progress.completed_at,
              created_at: progress.created_at,
              updated_at: progress.updated_at,
            },
            summary,
          };
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CourseProgressService;
