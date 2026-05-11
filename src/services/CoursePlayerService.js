// src/services/CoursePlayerService.js
// Player do aluno para cursos comprados (Slice 14).

const pool = require("../databases");
const CoursePlayerStorage = require("../storages/CoursePlayerStorage");
const CourseProgressStorage = require("../storages/CourseProgressStorage");
const CourseLessonMaterialsStorage = require("../storages/CourseLessonMaterialsStorage");
const CourseLessonQuestionsStorage = require("../storages/CourseLessonQuestionsStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CoursePlayerService");

function courseShape(row) {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    profile_id: row.profile_id || null,
    profile_display_name: row.profile_display_name || null,
    title: row.title,
    slug: row.slug,
    short_description: row.short_description,
    description: row.description,
    cover_url: row.cover_url,
    price_cents: row.price_cents,
    status: row.status,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function lessonShape(row) {
  return {
    id: row.id,
    course_id: row.course_id,
    module_id: row.module_id,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status,
    video_status: row.video_status,
    video_url: row.processed_video_url || row.original_video_url || null,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    completed_at: row.completed_at || null,
    is_completed: !!row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function moduleShape(row, lessons) {
  return {
    id: row.id,
    course_id: row.course_id,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status,
    lessons,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function materialShape(row) {
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

function questionShape(row) {
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    prompt: row.prompt,
    position: row.position,
    options: (row.options || []).map((o) => ({
      id: o.id,
      question_id: o.question_id,
      label: o.label,
      position: o.position,
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
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

class CoursePlayerService {
  static async getPlayer(user, courseId, lessonId = null) {
    return runWithLogs(
      log,
      "getPlayer",
      () => ({ id_user: user?.id_user, course_id: courseId, lesson_id: lessonId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const own = await ensureActiveEnrollment(pool, user.id_user, courseId);
        if (own.error) return own;

        const [course, modules, lessons, summary] = await Promise.all([
          CoursePlayerStorage.getCourseForStudent(pool, courseId),
          CoursePlayerStorage.listPublishedModules(pool, courseId),
          CoursePlayerStorage.listPublishedLessonsForUser(
            pool,
            courseId,
            user.id_user,
          ),
          CourseProgressStorage.getCourseProgressSummary(
            pool,
            user.id_user,
            courseId,
          ),
        ]);
        if (!course) return { error: "Curso não encontrado" };

        const publicLessons = lessons.map(lessonShape);
        const lessonMap = new Map();
        for (const lesson of publicLessons) {
          const list = lessonMap.get(lesson.module_id) || [];
          list.push(lesson);
          lessonMap.set(lesson.module_id, list);
        }
        const tree = modules
          .map((m) => moduleShape(m, lessonMap.get(m.id) || []))
          .filter((m) => m.lessons.length > 0);

        const activeLesson =
          publicLessons.find((l) => l.id === lessonId) || publicLessons[0] || null;
        if (lessonId && (!activeLesson || activeLesson.id !== lessonId)) {
          return { error: "Aula não encontrada" };
        }

        let materials = [];
        let questions = [];
        if (activeLesson) {
          const [materialRows, questionRows] = await Promise.all([
            CourseLessonMaterialsStorage.listByLesson(pool, activeLesson.id),
            CourseLessonQuestionsStorage.listByLesson(pool, activeLesson.id),
          ]);
          materials = materialRows.map(materialShape);
          questions = questionRows.map(questionShape);
        }

        return {
          course: courseShape(course),
          modules: tree,
          active_lesson: activeLesson,
          materials,
          questions,
          summary,
        };
      },
    );
  }
}

module.exports = CoursePlayerService;
