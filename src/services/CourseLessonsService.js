// src/services/CourseLessonsService.js
//
// Regras de negócio das aulas (Slice 5).
// Validação cruzada em todo acesso:
//   1) courses.owner_user_id === req.user.id_user
//   2) module.course_id === :courseId
//   3) lesson.module_id === :moduleId (em update/delete)
// Slices futuros (7/8) atualizam video_status/URLs via método dedicado.

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseModulesStorage = require("../storages/CourseModulesStorage");
const CourseLessonsStorage = require("../storages/CourseLessonsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseLessonsService");

const TITLE_MAX_LEN = 160;
const DESC_MAX_LEN = 20000;

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function normalizeStatus(value) {
  const s = String(value || "").toLowerCase();
  return ["draft", "published", "hidden"].includes(s) ? s : null;
}

async function ensureCourseOwnership(conn, courseId, userId) {
  if (!courseId) return { error: "ID do curso inválido" };
  const course = await CoursesStorage.getById(conn, courseId);
  if (!course) return { error: "Curso não encontrado" };
  if (course.owner_user_id !== userId) {
    return { error: "Sem permissão para acessar este curso" };
  }
  return { course };
}

async function ensureOwnershipAndModule(conn, courseId, moduleId, userId) {
  if (!courseId) return { error: "ID do curso inválido" };
  if (!moduleId) return { error: "ID do módulo inválido" };

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

  return { course, module: mod };
}

function publicLessonShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    course_id: row.course_id,
    module_id: row.module_id,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status,
    video_status: row.video_status,
    original_video_url: row.original_video_url,
    processed_video_url: row.processed_video_url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class CourseLessonsService {
  // --------------------------------------------------------------
  // Leituras
  // --------------------------------------------------------------

  static async list(user, courseId, moduleId) {
    return runWithLogs(
      log,
      "list",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureOwnershipAndModule(
          pool,
          courseId,
          moduleId,
          user.id_user,
        );
        if (own.error) return own;
        const rows = await CourseLessonsStorage.listByModule(pool, moduleId);
        return { lessons: rows.map(publicLessonShape) };
      },
    );
  }

  /**
   * Lista todas as aulas de um curso (flat). Usado pela sidebar da
   * página dedicada de edição de aula (Slice 6).
   */
  static async listAllByCourse(user, courseId) {
    return runWithLogs(
      log,
      "listAllByCourse",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureCourseOwnership(pool, courseId, user.id_user);
        if (own.error) return own;
        const rows = await CourseLessonsStorage.listByCourse(pool, courseId);
        return { lessons: rows.map(publicLessonShape) };
      },
    );
  }

  /**
   * Busca uma aula pelo id, validando que ela pertence ao curso passado.
   * Não exige saber o module_id na URL — o storage devolve essa info.
   */
  static async getOne(user, courseId, lessonId) {
    return runWithLogs(
      log,
      "getOne",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!lessonId) return { error: "ID da aula inválido" };
        const own = await ensureCourseOwnership(pool, courseId, user.id_user);
        if (own.error) return own;
        const lesson = await CourseLessonsStorage.getById(pool, lessonId);
        if (!lesson) return { error: "Aula não encontrada" };
        if (lesson.course_id !== courseId) {
          return { error: "Aula não pertence a este curso" };
        }
        return { lesson: publicLessonShape(lesson) };
      },
    );
  }

  // --------------------------------------------------------------
  // Mutações
  // --------------------------------------------------------------

  static async create(user, courseId, moduleId, body = {}) {
    return runWithLogs(
      log,
      "create",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };

        const title = sanitizeText(body.title, TITLE_MAX_LEN);
        if (!title) return { error: "Título é obrigatório" };

        const description = sanitizeText(body.description, DESC_MAX_LEN);
        const status = normalizeStatus(body.status) || "draft";

        const client = await pool.connect();
        try {
          const own = await ensureOwnershipAndModule(
            client,
            courseId,
            moduleId,
            user.id_user,
          );
          if (own.error) return own;

          const position = await CourseLessonsStorage.getNextPosition(
            client,
            moduleId,
          );
          const created = await CourseLessonsStorage.create(client, {
            courseId,
            moduleId,
            title,
            description,
            position,
            status,
          });
          return { lesson: publicLessonShape(created) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async update(user, courseId, moduleId, lessonId, body = {}) {
    return runWithLogs(
      log,
      "update",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!lessonId) return { error: "ID da aula inválido" };

        const client = await pool.connect();
        try {
          const own = await ensureOwnershipAndModule(
            client,
            courseId,
            moduleId,
            user.id_user,
          );
          if (own.error) return own;

          const existing = await CourseLessonsStorage.getById(client, lessonId);
          if (!existing) return { error: "Aula não encontrada" };
          if (existing.module_id !== moduleId) {
            return { error: "Aula não pertence a este módulo" };
          }

          const patch = {};
          if (body.title !== undefined) {
            const title = sanitizeText(body.title, TITLE_MAX_LEN);
            if (!title) return { error: "Título é obrigatório" };
            patch.title = title;
          }
          if (body.description !== undefined) {
            patch.description = sanitizeText(body.description, DESC_MAX_LEN);
          }
          if (body.status !== undefined) {
            const next = normalizeStatus(body.status);
            if (!next) return { error: "Status inválido" };
            patch.status = next;
          }
          // Campos de vídeo/thumb/duração ficam reservados para Slices 7 e 8
          // — deliberadamente NÃO expostos ao update genérico aqui.

          const updated = await CourseLessonsStorage.updateById(
            client,
            lessonId,
            patch,
          );
          return { lesson: publicLessonShape(updated) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async remove(user, courseId, moduleId, lessonId) {
    return runWithLogs(
      log,
      "remove",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!lessonId) return { error: "ID da aula inválido" };

        const client = await pool.connect();
        try {
          const own = await ensureOwnershipAndModule(
            client,
            courseId,
            moduleId,
            user.id_user,
          );
          if (own.error) return own;

          const existing = await CourseLessonsStorage.getById(client, lessonId);
          if (!existing) return { error: "Aula não encontrada" };
          if (existing.module_id !== moduleId) {
            return { error: "Aula não pertence a este módulo" };
          }

          const ok = await CourseLessonsStorage.deleteById(client, lessonId);
          return { deleted: ok };
        } finally {
          client.release();
        }
      },
    );
  }

  static async reorder(user, courseId, moduleId, orderedIds) {
    return runWithLogs(
      log,
      "reorder",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        count: Array.isArray(orderedIds) ? orderedIds.length : 0,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!Array.isArray(orderedIds) || !orderedIds.length) {
          return { error: "Lista de ordenação inválida" };
        }
        const seen = new Set();
        const cleaned = [];
        for (const id of orderedIds) {
          if (typeof id !== "string" || !id.trim()) continue;
          if (seen.has(id)) continue;
          seen.add(id);
          cleaned.push(id);
        }
        if (!cleaned.length) return { error: "Lista de ordenação inválida" };

        const client = await pool.connect();
        try {
          const own = await ensureOwnershipAndModule(
            client,
            courseId,
            moduleId,
            user.id_user,
          );
          if (own.error) return own;

          const existing = await CourseLessonsStorage.listByModule(
            client,
            moduleId,
          );
          const existingIds = new Set(existing.map((l) => l.id));
          for (const id of cleaned) {
            if (!existingIds.has(id)) {
              return { error: "ID de aula inválido na lista de ordenação" };
            }
          }

          await CourseLessonsStorage.setOrder(client, moduleId, cleaned);
          const rows = await CourseLessonsStorage.listByModule(client, moduleId);
          return { lessons: rows.map(publicLessonShape) };
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CourseLessonsService;
