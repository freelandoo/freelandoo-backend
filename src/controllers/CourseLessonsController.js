const CourseLessonsService = require("../services/CourseLessonsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseLessonsController {
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
