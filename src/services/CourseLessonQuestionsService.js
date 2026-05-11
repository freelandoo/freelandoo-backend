// src/services/CourseLessonQuestionsService.js
//
// Questionário das aulas (Slice 10). Cada pergunta tem N opções com
// exatamente 1 marcada como correta. Validação cruzada:
//   1) courses.owner_user_id === req.user.id_user
//   2) module.course_id === :courseId
//   3) lesson.module_id === :moduleId
//   4) question.lesson_id === :lessonId

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseModulesStorage = require("../storages/CourseModulesStorage");
const CourseLessonsStorage = require("../storages/CourseLessonsStorage");
const CourseLessonQuestionsStorage = require("../storages/CourseLessonQuestionsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseLessonQuestionsService");

const PROMPT_MAX_LEN = 2000;
const OPTION_LABEL_MAX_LEN = 500;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function normalizeOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) {
    return { error: "Lista de opções inválida" };
  }
  if (rawOptions.length < MIN_OPTIONS) {
    return { error: `Informe pelo menos ${MIN_OPTIONS} opções` };
  }
  if (rawOptions.length > MAX_OPTIONS) {
    return { error: `Máximo de ${MAX_OPTIONS} opções por pergunta` };
  }
  const cleaned = [];
  let correctCount = 0;
  for (const opt of rawOptions) {
    const label = sanitizeText(opt?.label, OPTION_LABEL_MAX_LEN);
    if (!label) return { error: "Cada opção precisa de um texto" };
    const isCorrect = !!opt?.is_correct;
    if (isCorrect) correctCount += 1;
    cleaned.push({ label, is_correct: isCorrect });
  }
  if (correctCount !== 1) {
    return { error: "Marque exatamente 1 opção como correta" };
  }
  return { options: cleaned };
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

function publicOptionShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    question_id: row.question_id,
    label: row.label,
    is_correct: !!row.is_correct,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicQuestionShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    prompt: row.prompt,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    options: Array.isArray(row.options)
      ? row.options.map(publicOptionShape)
      : [],
  };
}

class CourseLessonQuestionsService {
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
        const rows = await CourseLessonQuestionsStorage.listByLesson(
          pool,
          lessonId,
        );
        return { questions: rows.map(publicQuestionShape) };
      },
    );
  }

  // --------------------------------------------------------------
  // Mutações
  // --------------------------------------------------------------

  static async create(user, courseId, moduleId, lessonId, body = {}) {
    return runWithLogs(
      log,
      "create",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const prompt = sanitizeText(body.prompt, PROMPT_MAX_LEN);
        if (!prompt) return { error: "Enunciado é obrigatório" };
        const opts = normalizeOptions(body.options);
        if (opts.error) return opts;

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

          const position =
            await CourseLessonQuestionsStorage.getNextQuestionPosition(
              client,
              lessonId,
            );
          const created = await CourseLessonQuestionsStorage.createWithOptions(
            client,
            { lessonId, prompt, position, options: opts.options },
          );
          return { question: publicQuestionShape(created) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async update(user, courseId, moduleId, lessonId, questionId, body = {}) {
    return runWithLogs(
      log,
      "update",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
        question_id: questionId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!questionId) return { error: "ID da pergunta inválido" };

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

          const existing = await CourseLessonQuestionsStorage.getQuestionById(
            client,
            questionId,
          );
          if (!existing) return { error: "Pergunta não encontrada" };
          if (existing.lesson_id !== lessonId) {
            return { error: "Pergunta não pertence a esta aula" };
          }

          let nextQuestion = existing;
          if (body.prompt !== undefined) {
            const prompt = sanitizeText(body.prompt, PROMPT_MAX_LEN);
            if (!prompt) return { error: "Enunciado é obrigatório" };
            nextQuestion = await CourseLessonQuestionsStorage.updatePrompt(
              client,
              questionId,
              prompt,
            );
          }

          let nextOptions = null;
          if (body.options !== undefined) {
            const opts = normalizeOptions(body.options);
            if (opts.error) return opts;
            nextOptions = await CourseLessonQuestionsStorage.replaceOptions(
              client,
              questionId,
              opts.options,
            );
          } else {
            nextOptions = await CourseLessonQuestionsStorage.listOptionsByQuestion(
              client,
              questionId,
            );
          }

          return {
            question: publicQuestionShape({
              ...nextQuestion,
              options: nextOptions,
            }),
          };
        } finally {
          client.release();
        }
      },
    );
  }

  static async remove(user, courseId, moduleId, lessonId, questionId) {
    return runWithLogs(
      log,
      "remove",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        module_id: moduleId,
        lesson_id: lessonId,
        question_id: questionId,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!questionId) return { error: "ID da pergunta inválido" };

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

          const existing = await CourseLessonQuestionsStorage.getQuestionById(
            client,
            questionId,
          );
          if (!existing) return { error: "Pergunta não encontrada" };
          if (existing.lesson_id !== lessonId) {
            return { error: "Pergunta não pertence a esta aula" };
          }

          const ok = await CourseLessonQuestionsStorage.deleteQuestion(
            client,
            questionId,
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

          const existing = await CourseLessonQuestionsStorage.listByLesson(
            client,
            lessonId,
          );
          const existingIds = new Set(existing.map((q) => q.id));
          for (const id of cleaned) {
            if (!existingIds.has(id)) {
              return { error: "ID de pergunta inválido na lista" };
            }
          }

          await CourseLessonQuestionsStorage.setQuestionsOrder(
            client,
            lessonId,
            cleaned,
          );
          const rows = await CourseLessonQuestionsStorage.listByLesson(
            client,
            lessonId,
          );
          return { questions: rows.map(publicQuestionShape) };
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CourseLessonQuestionsService;
