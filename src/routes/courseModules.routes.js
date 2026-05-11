const { Router } = require("express");
const CourseModulesController = require("../controllers/CourseModulesController");
const uploadAvatar = require("../middlewares/uploadAvatar");
const asyncHandler = require("../utils/asyncHandler");
const courseLessonsRoutes = require("./courseLessons.routes");

// mergeParams permite acessar :courseId herdado do router pai (courses.routes.js).
const router = Router({ mergeParams: true });

// Recurso aninhado: aulas dentro de um módulo (Slice 5).
router.use("/:moduleId/lessons", courseLessonsRoutes);

router.get("/", asyncHandler(CourseModulesController.list));
router.post("/", asyncHandler(CourseModulesController.create));
// Reorder vem ANTES de /:id para não ser interceptado.
router.put("/order", asyncHandler(CourseModulesController.reorder));
router.put("/:id", asyncHandler(CourseModulesController.update));
router.delete("/:id", asyncHandler(CourseModulesController.remove));

// Banner do módulo (refactor UX). Reusa o middleware de avatar (JPG/PNG/WebP, 12MB).
router.post(
  "/:id/banner",
  uploadAvatar.single("banner"),
  asyncHandler(CourseModulesController.uploadBanner),
);
router.delete("/:id/banner", asyncHandler(CourseModulesController.removeBanner));

module.exports = router;
