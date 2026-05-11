const { Router } = require("express");
const CourseLessonsController = require("../controllers/CourseLessonsController");
const asyncHandler = require("../utils/asyncHandler");

// mergeParams herda :courseId e :moduleId do router pai (courseModules.routes.js
// monta este sob /:moduleId/lessons).
const router = Router({ mergeParams: true });

router.get("/", asyncHandler(CourseLessonsController.list));
router.post("/", asyncHandler(CourseLessonsController.create));
router.put("/order", asyncHandler(CourseLessonsController.reorder));
router.put("/:id", asyncHandler(CourseLessonsController.update));
router.delete("/:id", asyncHandler(CourseLessonsController.remove));

module.exports = router;
