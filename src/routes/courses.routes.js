const { Router } = require("express");
const CoursesController = require("../controllers/CoursesController");
const CourseLessonCommentsController = require("../controllers/CourseLessonCommentsController");
const CourseLessonsController = require("../controllers/CourseLessonsController");
const CoursePlayerController = require("../controllers/CoursePlayerController");
const CourseProgressController = require("../controllers/CourseProgressController");
const CourseStudentsController = require("../controllers/CourseStudentsController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const courseModulesRoutes = require("./courseModules.routes");

const router = Router();

// Tudo aqui exige autenticação — o owner é sempre req.user.
router.use(authMiddleware);

// Recursos aninhados (Slice 4: módulos). Renomeia :id -> :courseId no nested.
router.use("/:courseId/modules", courseModulesRoutes);

// Rotas flat de aulas (Slice 6: página de edição da aula).
// CRUD continua aninhado em /:courseId/modules/:moduleId/lessons,
// mas para LER uma aula isolada ou a árvore inteira do curso,
// estes endpoints evitam a necessidade de conhecer o module_id.
router.get(
  "/:courseId/lessons",
  asyncHandler(CourseLessonsController.listAllByCourse),
);
router.get(
  "/:courseId/lessons/:lessonId",
  asyncHandler(CourseLessonsController.getOne),
);

router.get("/", asyncHandler(CoursesController.listMine));
router.post("/", asyncHandler(CoursesController.create));
router.get("/purchased", asyncHandler(CourseStudentsController.listPurchased));
router.get(
  "/purchased/:courseId/progress",
  asyncHandler(CourseProgressController.getCourseProgress),
);
router.get(
  "/purchased/:courseId/player",
  asyncHandler(CoursePlayerController.getPlayer),
);
router.put(
  "/purchased/:courseId/lessons/:lessonId/progress",
  asyncHandler(CourseProgressController.setLessonCompleted),
);
router.get(
  "/purchased/:courseId/lessons/:lessonId/comments",
  asyncHandler(CourseLessonCommentsController.listForStudent),
);
router.post(
  "/purchased/:courseId/lessons/:lessonId/comments",
  asyncHandler(CourseLessonCommentsController.createForStudent),
);
router.delete(
  "/purchased/:courseId/lessons/:lessonId/comments/:id",
  asyncHandler(CourseLessonCommentsController.removeForStudent),
);
router.get("/:id/students", asyncHandler(CourseStudentsController.list));
router.get("/:id", asyncHandler(CoursesController.getMineById));
router.put("/:id", asyncHandler(CoursesController.update));
router.delete("/:id", asyncHandler(CoursesController.remove));

module.exports = router;
