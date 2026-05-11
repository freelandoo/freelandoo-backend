// src/services/CourseModulesService.js
//
// Regras de negócio dos módulos de curso (Slice 4).
// Authorship é validado contra courses.owner_user_id em cada operação:
// só o dono do curso pode listar/criar/editar/excluir/reordenar módulos.

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseModulesStorage = require("../storages/CourseModulesStorage");
const uploadCourseImageToR2 = require("../integrations/r2/uploadCourseImageToR2");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseModulesService");

const TITLE_MAX_LEN = 160;
const DESC_MAX_LEN = 500;

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

function publicModuleShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    course_id: row.course_id,
    title: row.title,
    description: row.description,
    banner_url: row.banner_url ?? null,
    position: row.position,
    status: row.status,
    lessons_count: row.lessons_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class CourseModulesService {
  // --------------------------------------------------------------
  // Leituras
  // --------------------------------------------------------------

  static async list(user, courseId) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureCourseOwnership(pool, courseId, user.id_user);
        if (own.error) return own;
        const rows = await CourseModulesStorage.listByCourse(pool, courseId);
        return { modules: rows.map(publicModuleShape) };
      },
    );
  }

  // --------------------------------------------------------------
  // Mutações
  // --------------------------------------------------------------

  static async create(user, courseId, body = {}) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };

        const title = sanitizeText(body.title, TITLE_MAX_LEN);
        if (!title) return { error: "Título é obrigatório" };

        const description = sanitizeText(body.description, DESC_MAX_LEN);
        const status = normalizeStatus(body.status) || "draft";
        const bannerUrl =
          typeof body.banner_url === "string" && body.banner_url.trim()
            ? body.banner_url.trim()
            : null;

        const client = await pool.connect();
        try {
          const own = await ensureCourseOwnership(client, courseId, user.id_user);
          if (own.error) return own;

          const position = await CourseModulesStorage.getNextPosition(
            client,
            courseId,
          );
          const created = await CourseModulesStorage.create(client, {
            courseId,
            title,
            description,
            bannerUrl,
            position,
            status,
          });
          return { module: publicModuleShape(created) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async update(user, courseId, moduleId, body = {}) {
    return runWithLogs(
      log,
      "update",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!moduleId) return { error: "ID do módulo inválido" };

        const client = await pool.connect();
        try {
          const own = await ensureCourseOwnership(client, courseId, user.id_user);
          if (own.error) return own;

          const existing = await CourseModulesStorage.getById(client, moduleId);
          if (!existing) return { error: "Módulo não encontrado" };
          if (existing.course_id !== courseId) {
            return { error: "Módulo não pertence a este curso" };
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
          if (body.banner_url !== undefined) {
            if (body.banner_url === null) {
              patch.banner_url = null;
            } else if (typeof body.banner_url === "string") {
              const trimmed = body.banner_url.trim();
              patch.banner_url = trimmed || null;
            }
          }

          const updated = await CourseModulesStorage.updateById(
            client,
            moduleId,
            patch,
          );
          return { module: publicModuleShape(updated) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async uploadBanner(user, courseId, moduleId, file) {
    return runWithLogs(
      log,
      "uploadBanner",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        size: file?.size,
        mimetype: file?.mimetype,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!moduleId) return { error: "ID do módulo inválido" };
        if (!file?.buffer?.length) return { error: "Arquivo não enviado" };

        const own = await ensureCourseOwnership(pool, courseId, user.id_user);
        if (own.error) return own;

        const existing = await CourseModulesStorage.getById(pool, moduleId);
        if (!existing) return { error: "Módulo não encontrado" };
        if (existing.course_id !== courseId) {
          return { error: "Módulo não pertence a este curso" };
        }

        let url;
        try {
          url = await uploadCourseImageToR2({
            file,
            kind: "module-banner",
            courseId,
            resourceId: moduleId,
          });
        } catch (err) {
          return { error: err?.message || "Falha ao enviar banner" };
        }

        const updated = await CourseModulesStorage.updateById(pool, moduleId, {
          banner_url: url,
        });
        return { module: publicModuleShape(updated) };
      },
    );
  }

  static async removeBanner(user, courseId, moduleId) {
    return runWithLogs(
      log,
      "removeBanner",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!moduleId) return { error: "ID do módulo inválido" };

        const own = await ensureCourseOwnership(pool, courseId, user.id_user);
        if (own.error) return own;

        const existing = await CourseModulesStorage.getById(pool, moduleId);
        if (!existing) return { error: "Módulo não encontrado" };
        if (existing.course_id !== courseId) {
          return { error: "Módulo não pertence a este curso" };
        }

        const updated = await CourseModulesStorage.updateById(pool, moduleId, {
          banner_url: null,
        });
        return { module: publicModuleShape(updated) };
      },
    );
  }

  static async remove(user, courseId, moduleId) {
    return runWithLogs(
      log,
      "remove",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!moduleId) return { error: "ID do módulo inválido" };

        const client = await pool.connect();
        try {
          const own = await ensureCourseOwnership(client, courseId, user.id_user);
          if (own.error) return own;

          const existing = await CourseModulesStorage.getById(client, moduleId);
          if (!existing) return { error: "Módulo não encontrado" };
          if (existing.course_id !== courseId) {
            return { error: "Módulo não pertence a este curso" };
          }

          const ok = await CourseModulesStorage.deleteById(client, moduleId);
          return { deleted: ok };
        } finally {
          client.release();
        }
      },
    );
  }

  static async reorder(user, courseId, orderedIds) {
    return runWithLogs(
      log,
      "reorder",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        count: Array.isArray(orderedIds) ? orderedIds.length : 0,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!Array.isArray(orderedIds) || !orderedIds.length) {
          return { error: "Lista de ordenação inválida" };
        }
        // Filtra entradas não-string e duplicatas, mantendo a primeira ocorrência.
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
          const own = await ensureCourseOwnership(client, courseId, user.id_user);
          if (own.error) return own;

          // Valida que todos os IDs informados pertencem ao curso.
          const existing = await CourseModulesStorage.listByCourse(client, courseId);
          const existingIds = new Set(existing.map((m) => m.id));
          for (const id of cleaned) {
            if (!existingIds.has(id)) {
              return { error: "ID de módulo inválido na lista de ordenação" };
            }
          }

          await CourseModulesStorage.setOrder(client, courseId, cleaned);
          const rows = await CourseModulesStorage.listByCourse(client, courseId);
          return { modules: rows.map(publicModuleShape) };
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CourseModulesService;
