const { Router } = require("express");
const CourseLessonsController = require("../controllers/CourseLessonsController");
const uploadCourseVideo = require("../middlewares/uploadCourseVideo");
const asyncHandler = require("../utils/asyncHandler");
const courseLessonCommentsRoutes = require("./courseLessonComments.routes");
const courseLessonMaterialsRoutes = require("./courseLessonMaterials.routes");
const courseLessonQuestionsRoutes = require("./courseLessonQuestions.routes");

// mergeParams herda :courseId e :moduleId do router pai (courseModules.routes.js
// monta este sob /:moduleId/lessons).
const router = Router({ mergeParams: true });

// Materiais de apoio (Slice 9). Renomeia :id → :lessonId no nested.
router.use("/:lessonId/materials", courseLessonMaterialsRoutes);
// Questionário da aula (Slice 10). Mesmo padrão de aninhamento.
router.use("/:lessonId/questions", courseLessonQuestionsRoutes);
router.use("/:lessonId/comments", courseLessonCommentsRoutes);

router.get("/", asyncHandler(CourseLessonsController.list));
router.post("/", asyncHandler(CourseLessonsController.create));
router.put("/order", asyncHandler(CourseLessonsController.reorder));
router.put("/:id", asyncHandler(CourseLessonsController.update));
router.delete("/:id", asyncHandler(CourseLessonsController.remove));

// Vídeo da aula (Slice 7). Multipart com field "video".
router.post(
  "/:id/video",
  uploadCourseVideo.single("video"),
  asyncHandler(CourseLessonsController.uploadVideo),
);
router.delete("/:id/video", asyncHandler(CourseLessonsController.removeVideo));

module.exports = router;
