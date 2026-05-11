const CourseStudentsService = require("../services/CourseStudentsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseStudentsController {
  static async list(req, res) {
    return sendServiceResult(
      res,
      await CourseStudentsService.list(req.user, req.params.id),
    );
  }
}

module.exports = CourseStudentsController;
