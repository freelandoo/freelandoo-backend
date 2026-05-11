// src/services/CourseLessonMaterialsService.js
//
// Materiais de apoio das aulas (Slice 9).
// Validação cruzada em todo acesso:
//   1) courses.owner_user_id === req.user.id_user
//   2) module.course_id === :courseId
//   3) lesson.module_id === :moduleId
//   4) material.lesson_id === :lessonId (em update/delete)

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseModulesStorage = require("../storages/CourseModulesStorage");
const CourseLessonsStorage = require("../storages/CourseLessonsStorage");
const CourseLessonMaterialsStorage = require("../storages/CourseLessonMaterialsStorage");
const uploadCourseMaterialToR2 = require("../integrations/r2/uploadCourseMaterialToR2");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseLessonMaterialsService");

const TITLE_MAX_LEN = 200;
const LINK_URL_MAX_LEN = 2000;

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function ensureFullOwnership(conn, courseId, moduleId, lessonId, userId) {
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

function publicMaterialShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    kind: row.kind,
    title: row.title,
    file_url: row.file_url,
    file_size_bytes:
      row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    mime: row.mime,
    link_url: row.link_url,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class CourseLessonMaterialsService {
  // --------------------------------------------------------------
  // Leituras
  // --------------------------------------------------------------

  static async list(user, courseId, moduleId, lessonId) {
    return runWithLogs(
      log,
      "list",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureFullOwnership(
          pool,
          courseId,
          moduleId,
          lessonId,
          user.id_user,
        );
        if (own.error) return own;
        const rows = await CourseLessonMaterialsStorage.listByLesson(
          pool,
          lessonId,
        );
        return { materials: rows.map(publicMaterialShape) };
      },
    );
  }

  // --------------------------------------------------------------
  // Mutações
  // --------------------------------------------------------------

  static async createFile(user, courseId, moduleId, lessonId, body, file) {
    return runWithLogs(
      log,
      "createFile",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
        size: file?.size,
        mimetype: file?.mimetype,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!file?.buffer?.length) return { error: "Arquivo não enviado" };

        const title =
          sanitizeText(body?.title, TITLE_MAX_LEN) || file.originalname;
        if (!title) return { error: "Título é obrigatório" };

        const client = await pool.connect();
        try {
          const own = await ensureFullOwnership(
            client,
            courseId,
            moduleId,
            lessonId,
            user.id_user,
          );
          if (own.error) return own;

          const { url } = await uploadCourseMaterialToR2({
            file,
            userId: user.id_user,
            courseId,
            lessonId,
          });

          const position = await CourseLessonMaterialsStorage.getNextPosition(
            client,
            lessonId,
          );
          const created = await CourseLessonMaterialsStorage.createFile(
            client,
            {
              lessonId,
              title: title.slice(0, TITLE_MAX_LEN),
              fileUrl: url,
              fileSizeBytes: file.size,
              mime: file.mimetype,
              position,
            },
          );
          return { material: publicMaterialShape(created) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async createLink(user, courseId, moduleId, lessonId, body = {}) {
    return runWithLogs(
      log,
      "createLink",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };

        const title = sanitizeText(body.title, TITLE_MAX_LEN);
        if (!title) return { error: "Título é obrigatório" };

        const linkUrl = sanitizeText(body.link_url, LINK_URL_MAX_LEN);
        if (!linkUrl) return { error: "URL é obrigatória" };
        if (!isValidHttpUrl(linkUrl)) {
          return { error: "URL inválida — use http(s)://" };
        }

        const client = await pool.connect();
        try {
          const own = await ensureFullOwnership(
            client,
            courseId,
            moduleId,
            lessonId,
            user.id_user,
          );
          if (own.error) return own;

          const position = await CourseLessonMaterialsStorage.getNextPosition(
            client,
            lessonId,
          );
          const created = await CourseLessonMaterialsStorage.createLink(client, {
            lessonId,
            title,
            linkUrl,
            position,
          });
          return { material: publicMaterialShape(created) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async update(user, courseId, moduleId, lessonId, materialId, body = {}) {
    return runWithLogs(
      log,
      "update",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
        material_id: materialId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!materialId) return { error: "ID do material inválido" };

        const client = await pool.connect();
        try {
          const own = await ensureFullOwnership(
            client,
            courseId,
            moduleId,
            lessonId,
            user.id_user,
          );
          if (own.error) return own;

          const existing = await CourseLessonMaterialsStorage.getById(
            client,
            materialId,
          );
          if (!existing) return { error: "Material não encontrado" };
          if (existing.lesson_id !== lessonId) {
            return { error: "Material não pertence a esta aula" };
          }

          const patch = {};
          if (body.title !== undefined) {
            const title = sanitizeText(body.title, TITLE_MAX_LEN);
            if (!title) return { error: "Título é obrigatório" };
            patch.title = title;
          }
          if (body.link_url !== undefined) {
            if (existing.kind !== "link") {
              return { error: "Só materiais do tipo link aceitam link_url" };
            }
            const linkUrl = sanitizeText(body.link_url, LINK_URL_MAX_LEN);
            if (!linkUrl) return { error: "URL é obrigatória" };
            if (!isValidHttpUrl(linkUrl)) {
              return { error: "URL inválida — use http(s)://" };
            }
            patch.link_url = linkUrl;
          }

          const updated = await CourseLessonMaterialsStorage.updateById(
            client,
            materialId,
            patch,
          );
          return { material: publicMaterialShape(updated) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async remove(user, courseId, moduleId, lessonId, materialId) {
    return runWithLogs(
      log,
      "remove",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
        material_id: materialId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!materialId) return { error: "ID do material inválido" };

        const client = await pool.connect();
        try {
          const own = await ensureFullOwnership(
            client,
            courseId,
            moduleId,
            lessonId,
            user.id_user,
          );
          if (own.error) return own;

          const existing = await CourseLessonMaterialsStorage.getById(
            client,
            materialId,
          );
          if (!existing) return { error: "Material não encontrado" };
          if (existing.lesson_id !== lessonId) {
            return { error: "Material não pertence a esta aula" };
          }

          const ok = await CourseLessonMaterialsStorage.deleteById(
            client,
            materialId,
          );
          return { deleted: ok };
        } finally {
          client.release();
        }
      },
    );
  }

  static async reorder(user, courseId, moduleId, lessonId, orderedIds) {
    return runWithLogs(
      log,
      "reorder",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
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
          const own = await ensureFullOwnership(
            client,
            courseId,
            moduleId,
            lessonId,
            user.id_user,
          );
          if (own.error) return own;

          const existing = await CourseLessonMaterialsStorage.listByLesson(
            client,
            lessonId,
          );
          const existingIds = new Set(existing.map((m) => m.id));
          for (const id of cleaned) {
            if (!existingIds.has(id)) {
              return { error: "ID de material inválido na lista" };
            }
          }

          await CourseLessonMaterialsStorage.setOrder(client, lessonId, cleaned);
          const rows = await CourseLessonMaterialsStorage.listByLesson(
            client,
            lessonId,
          );
          return { materials: rows.map(publicMaterialShape) };
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CourseLessonMaterialsService;
