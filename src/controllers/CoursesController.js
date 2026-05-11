const CoursesService = require("../services/CoursesService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CoursesController {
  // GET /me/courses
  static async listMine(req, res) {
    return sendServiceResult(res, await CoursesService.listMine(req.user));
  }

  // GET /me/courses/:id
  static async getMineById(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.getMineById(req.user, req.params.id),
    );
  }

  // POST /me/courses
  static async create(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.create(req.user, req.body || {}),
      201,
    );
  }

  // PUT /me/courses/:id
  static async update(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.update(req.user, req.params.id, req.body || {}),
    );
  }

  // DELETE /me/courses/:id
  static async remove(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.remove(req.user, req.params.id),
    );
  }
}

module.exports = CoursesController;
