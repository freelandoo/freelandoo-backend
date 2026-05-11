const CourseLessonQuestionsService = require("../services/CourseLessonQuestionsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseLessonQuestionsController {
  static async list(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonQuestionsService.list(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
      ),
    );
  }

  static async create(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonQuestionsService.create(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        req.body || {},
      ),
      201,
    );
  }

  static async update(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonQuestionsService.update(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        req.params.id,
        req.body || {},
      ),
    );
  }

  static async remove(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonQuestionsService.remove(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        req.params.id,
      ),
    );
  }

  static async reorder(req, res) {
    const body = req.body || {};
    const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : [];
    return sendServiceResult(
      res,
      await CourseLessonQuestionsService.reorder(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        orderedIds,
      ),
    );
  }
}

module.exports = CourseLessonQuestionsController;
