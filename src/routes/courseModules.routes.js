const { Router } = require("express");
const CourseModulesController = require("../controllers/CourseModulesController");
const asyncHandler = require("../utils/asyncHandler");

// mergeParams permite acessar :courseId herdado do router pai (courses.routes.js).
const router = Router({ mergeParams: true });

router.get("/", asyncHandler(CourseModulesController.list));
router.post("/", asyncHandler(CourseModulesController.create));
// Reorder vem ANTES de /:id para não ser interceptado.
router.put("/order", asyncHandler(CourseModulesController.reorder));
router.put("/:id", asyncHandler(CourseModulesController.update));
router.delete("/:id", asyncHandler(CourseModulesController.remove));

module.exports = router;
