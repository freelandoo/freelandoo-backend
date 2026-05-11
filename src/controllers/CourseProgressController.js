const CourseProgressService = require("../services/CourseProgressService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseProgressController {
  static async getCourseProgress(req, res) {
    return sendServiceResult(
      res,
      await CourseProgressService.getCourseProgress(
        req.user,
        req.params.courseId,
      ),
    );
  }

  static async setLessonCompleted(req, res) {
    return sendServiceResult(
      res,
      await CourseProgressService.setLessonCompleted(
        req.user,
        req.params.courseId,
        req.params.lessonId,
        req.body || {},
      ),
    );
  }
}

module.exports = CourseProgressController;
