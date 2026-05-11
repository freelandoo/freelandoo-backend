const CourseModulesService = require("../services/CourseModulesService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseModulesController {
  // GET /me/courses/:courseId/modules
  static async list(req, res) {
    return sendServiceResult(
      res,
      await CourseModulesService.list(req.user, req.params.courseId),
    );
  }

  // POST /me/courses/:courseId/modules
  static async create(req, res) {
    return sendServiceResult(
      res,
      await CourseModulesService.create(
        req.user,
        req.params.courseId,
        req.body || {},
      ),
      201,
    );
  }

  // PUT /me/courses/:courseId/modules/:id
  static async update(req, res) {
    return sendServiceResult(
      res,
      await CourseModulesService.update(
        req.user,
        req.params.courseId,
        req.params.id,
        req.body || {},
      ),
    );
  }

  // DELETE /me/courses/:courseId/modules/:id
  static async remove(req, res) {
    return sendServiceResult(
      res,
      await CourseModulesService.remove(
        req.user,
        req.params.courseId,
        req.params.id,
      ),
    );
  }

  // PUT /me/courses/:courseId/modules/order
  // body: { ordered_ids: ["uuid1","uuid2",...] }
  static async reorder(req, res) {
    const body = req.body || {};
    const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : [];
    return sendServiceResult(
      res,
      await CourseModulesService.reorder(
        req.user,
        req.params.courseId,
        orderedIds,
      ),
    );
  }
}

module.exports = CourseModulesController;
