const { Router } = require("express");
const BlogController = require("../controllers/BlogController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/posts", asyncHandler(BlogController.list));
router.get("/posts/:slug", asyncHandler(BlogController.getBySlug));

module.exports = router;
