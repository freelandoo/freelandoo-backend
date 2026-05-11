const { Router } = require("express");
const CourseLessonMaterialsController = require("../controllers/CourseLessonMaterialsController");
const uploadCourseMaterial = require("../middlewares/uploadCourseMaterial");
const asyncHandler = require("../utils/asyncHandler");

// mergeParams herda :courseId, :moduleId e :lessonId do router pai
// (courseLessons.routes.js → /:id/materials).
const router = Router({ mergeParams: true });

router.get("/", asyncHandler(CourseLessonMaterialsController.list));

// Reorder e os dois POSTs distintos vêm antes de /:id para não serem
// interceptados pela rota dinâmica.
router.put("/order", asyncHandler(CourseLessonMaterialsController.reorder));
router.post(
  "/files",
  uploadCourseMaterial.single("file"),
  asyncHandler(CourseLessonMaterialsController.createFile),
);
router.post("/links", asyncHandler(CourseLessonMaterialsController.createLink));

router.put("/:id", asyncHandler(CourseLessonMaterialsController.update));
router.delete("/:id", asyncHandler(CourseLessonMaterialsController.remove));

module.exports = router;
