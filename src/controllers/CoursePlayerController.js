const CoursePlayerService = require("../services/CoursePlayerService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CoursePlayerController {
  static async getPlayer(req, res) {
    return sendServiceResult(
      res,
      await CoursePlayerService.getPlayer(
        req.user,
        req.params.courseId,
        req.query?.lessonId || null,
      ),
    );
  }
}

module.exports = CoursePlayerController;
