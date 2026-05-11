const CourseLessonCommentsService = require("../services/CourseLessonCommentsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseLessonCommentsController {
  static async listForOwner(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonCommentsService.listForOwner(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
      ),
    );
  }

  static async removeForOwner(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonCommentsService.removeForOwner(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        req.params.id,
      ),
    );
  }

  static async listForStudent(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonCommentsService.listForStudent(
        req.user,
        req.params.courseId,
        req.params.lessonId,
      ),
    );
  }

  static async createForStudent(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonCommentsService.createForStudent(
        req.user,
        req.params.courseId,
        req.params.lessonId,
        req.body || {},
      ),
      201,
    );
  }

  static async removeForStudent(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonCommentsService.removeForStudent(
        req.user,
        req.params.courseId,
        req.params.lessonId,
        req.params.id,
      ),
    );
  }
}

module.exports = CourseLessonCommentsController;
