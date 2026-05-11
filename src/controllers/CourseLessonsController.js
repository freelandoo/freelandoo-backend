const CourseLessonsService = require("../services/CourseLessonsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseLessonsController {
  // GET /me/courses/:courseId/lessons
  static async listAllByCourse(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.listAllByCourse(req.user, req.params.courseId),
    );
  }

  // GET /me/courses/:courseId/lessons/:lessonId
  static async getOne(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.getOne(
        req.user,
        req.params.courseId,
        req.params.lessonId,
      ),
    );
  }

  static async list(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.list(
        req.user,
        req.params.courseId,
        req.params.moduleId,
      ),
    );
  }

  static async create(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.create(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.body || {},
      ),
      201,
    );
  }

  static async update(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.update(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.id,
        req.body || {},
      ),
    );
  }

  static async remove(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.remove(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.id,
      ),
    );
  }

  // POST /me/courses/:courseId/modules/:moduleId/lessons/:id/video
  static async uploadVideo(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.uploadVideo(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.id,
        req.file,
      ),
    );
  }

  // DELETE /me/courses/:courseId/modules/:moduleId/lessons/:id/video
  static async removeVideo(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.removeVideo(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.id,
      ),
    );
  }

  // POST /me/courses/:courseId/modules/:moduleId/lessons/:id/cover
  // multipart, field "cover"
  static async uploadCover(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.uploadCover(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.id,
        req.file,
      ),
    );
  }

  // DELETE /me/courses/:courseId/modules/:moduleId/lessons/:id/cover
  static async removeCover(req, res) {
    return sendServiceResult(
      res,
      await CourseLessonsService.removeCover(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        req.params.id,
      ),
    );
  }

  static async reorder(req, res) {
    const body = req.body || {};
    const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : [];
    return sendServiceResult(
      res,
      await CourseLessonsService.reorder(
        req.user,
        req.params.courseId,
        req.params.moduleId,
        orderedIds,
      ),
    );
  }
}

module.exports = CourseLessonsController;
