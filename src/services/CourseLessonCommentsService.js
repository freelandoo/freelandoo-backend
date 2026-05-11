// src/services/CourseLessonCommentsService.js
// Comentários das aulas: aluno matriculado comenta, criador modera.

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseModulesStorage = require("../storages/CourseModulesStorage");
const CourseLessonsStorage = require("../storages/CourseLessonsStorage");
const CourseProgressStorage = require("../storages/CourseProgressStorage");
const CourseLessonCommentsStorage = require("../storages/CourseLessonCommentsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseLessonCommentsService");
const BODY_MAX_LEN = 2000;

function sanitizeBody(value) {
  const s = String(value || "").trim();
  return s ? s.slice(0, BODY_MAX_LEN) : null;
}

function publicCommentShape(row, viewerUserId) {
  return {
    id: row.id,
    course_id: row.course_id,
    lesson_id: row.lesson_id,
    user_id: row.user_id,
    body: row.body,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author_name: row.profile_display_name || row.user_name || "Aluno",
    author_avatar: row.profile_avatar_url || row.user_avatar || null,
    is_mine: row.user_id === viewerUserId,
  };
}

async function ensureOwnerLesson(conn, courseId, moduleId, lessonId, userId) {
  if (!courseId) return { error: "ID do curso inválido" };
  if (!moduleId) return { error: "ID do módulo inválido" };
  if (!lessonId) return { error: "ID da aula inválido" };

  const course = await CoursesStorage.getById(conn, courseId);
  if (!course) return { error: "Curso não encontrado" };
  if (course.owner_user_id !== userId) {
    return { error: "Sem permissão para acessar este curso" };
  }
  const mod = await CourseModulesStorage.getById(conn, moduleId);
  if (!mod) return { error: "Módulo não encontrado" };
  if (mod.course_id !== courseId) {
    return { error: "Módulo não pertence a este curso" };
  }
  const lesson = await CourseLessonsStorage.getById(conn, lessonId);
  if (!lesson) return { error: "Aula não encontrada" };
  if (lesson.module_id !== moduleId) {
    return { error: "Aula não pertence a este módulo" };
  }
  return { course, module: mod, lesson };
}

async function ensureStudentLesson(conn, courseId, lessonId, userId) {
  if (!courseId) return { error: "ID do curso inválido" };
  if (!lessonId) return { error: "ID da aula inválido" };
  const enrollment = await CourseProgressStorage.getActiveEnrollment(
    conn,
    userId,
    courseId,
  );
  if (!enrollment) return { error: "Matrícula ativa não encontrada" };
  const lesson = await CourseProgressStorage.getLessonForProgress(
    conn,
    courseId,
    lessonId,
  );
  if (!lesson) return { error: "Aula não encontrada" };
  if (lesson.status !== "published") {
    return { error: "Aula não publicada" };
  }
  return { enrollment, lesson };
}

class CourseLessonCommentsService {
  static async listForOwner(user, courseId, moduleId, lessonId) {
    return runWithLogs(
      log,
      "listForOwner",
      () => ({ id_user: user?.id_user, course_id: courseId, lesson_id: lessonId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureOwnerLesson(
          pool,
          courseId,
          moduleId,
          lessonId,
          user.id_user,
        );
        if (own.error) return own;
        const rows = await CourseLessonCommentsStorage.listByLesson(
          pool,
          lessonId,
        );
        return { comments: rows.map((r) => publicCommentShape(r, user.id_user)) };
      },
    );
  }

  static async listForStudent(user, courseId, lessonId) {
    return runWithLogs(
      log,
      "listForStudent",
      () => ({ id_user: user?.id_user, course_id: courseId, lesson_id: lessonId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureStudentLesson(pool, courseId, lessonId, user.id_user);
        if (own.error) return own;
        const rows = await CourseLessonCommentsStorage.listByLesson(pool, lessonId);
        return { comments: rows.map((r) => publicCommentShape(r, user.id_user)) };
      },
    );
  }

  static async createForStudent(user, courseId, lessonId, body = {}) {
    return runWithLogs(
      log,
      "createForStudent",
      () => ({ id_user: user?.id_user, course_id: courseId, lesson_id: lessonId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const text = sanitizeBody(body.body);
        if (!text) return { error: "Comentário é obrigatório" };

        const own = await ensureStudentLesson(pool, courseId, lessonId, user.id_user);
        if (own.error) return own;
        await CourseLessonCommentsStorage.create(pool, {
          courseId,
          lessonId,
          userId: user.id_user,
          body: text,
        });
        const rows = await CourseLessonCommentsStorage.listByLesson(pool, lessonId);
        const created = rows.find((r) => r.user_id === user.id_user && r.body === text);
        return { comment: publicCommentShape(created || rows[0], user.id_user) };
      },
    );
  }

  static async removeForStudent(user, courseId, lessonId, commentId) {
    return runWithLogs(
      log,
      "removeForStudent",
      () => ({ id_user: user?.id_user, comment_id: commentId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureStudentLesson(pool, courseId, lessonId, user.id_user);
        if (own.error) return own;
        const existing = await CourseLessonCommentsStorage.getById(pool, commentId);
        if (!existing) return { error: "Comentário não encontrado" };
        if (existing.lesson_id !== lessonId) {
          return { error: "Comentário não pertence a esta aula" };
        }
        if (existing.user_id !== user.id_user) {
          return { error: "Sem permissão para remover este comentário" };
        }
        await CourseLessonCommentsStorage.softDelete(pool, commentId);
        return { deleted: true };
      },
    );
  }

  static async removeForOwner(user, courseId, moduleId, lessonId, commentId) {
    return runWithLogs(
      log,
      "removeForOwner",
      () => ({ id_user: user?.id_user, comment_id: commentId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureOwnerLesson(
          pool,
          courseId,
          moduleId,
          lessonId,
          user.id_user,
        );
        if (own.error) return own;
        const existing = await CourseLessonCommentsStorage.getById(pool, commentId);
        if (!existing) return { error: "Comentário não encontrado" };
        if (existing.lesson_id !== lessonId) {
          return { error: "Comentário não pertence a esta aula" };
        }
        await CourseLessonCommentsStorage.softDelete(pool, commentId);
        return { deleted: true };
      },
    );
  }
}

module.exports = CourseLessonCommentsService;
