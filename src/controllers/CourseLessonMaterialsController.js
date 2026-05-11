const CourseLessonMaterialsService = require("../services/CourseLessonMaterialsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseLessonMaterialsController {
  static async list(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonMaterialsService.list(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
      ),
    );
  }

  static async createFile(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonMaterialsService.createFile(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        req.body || {},
        req.file,
      ),
      201,
    );
  }

  static async createLink(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonMaterialsService.createLink(
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
      await CourseLessonMaterialsService.update(
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
      await CourseLessonMaterialsService.remove(
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
      await CourseLessonMaterialsService.reorder(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.lessonId,
        orderedIds,
      ),
    );
  }
}

module.exports = CourseLessonMaterialsController;
