const { Router } = require("express");
const CourseLessonCommentsController = require("../controllers/CourseLessonCommentsController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/", asyncHandler(CourseLessonCommentsController.listForOwner));
router.delete("/:id", asyncHandler(CourseLessonCommentsController.removeForOwner));

module.exports = router;
