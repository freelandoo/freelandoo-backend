const { Router } = require("express");
const CourseLessonQuestionsController = require("../controllers/CourseLessonQuestionsController");
const asyncHandler = require("../utils/asyncHandler");

// mergeParams herda :courseId, :moduleId e :lessonId do router pai
// (courseLessons.routes.js → /:lessonId/questions).
const router = Router({ mergeParams: true });

router.get("/", asyncHandler(CourseLessonQuestionsController.list));
router.post("/", asyncHandler(CourseLessonQuestionsController.create));

// Reorder vem ANTES de /:id para não ser interceptado pela rota dinâmica.
router.put("/order", asyncHandler(CourseLessonQuestionsController.reorder));
router.put("/:id", asyncHandler(CourseLessonQuestionsController.update));
router.delete("/:id", asyncHandler(CourseLessonQuestionsController.remove));

module.exports = router;
