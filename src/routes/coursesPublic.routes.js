const { Router } = require("express");
const CoursesController = require("../controllers/CoursesController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Visão pública do curso por slug — sem auth, só retorna se published.
router.get(
  "/public/by-slug/:slug",
  asyncHandler(CoursesController.getPublicBySlug),
);

module.exports = router;
