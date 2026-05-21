const { Router } = require("express");
const SearchController = require("../controllers/SearchController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", asyncHandler(SearchController.search));
router.get("/products", asyncHandler(SearchController.searchProducts));
router.get("/courses", asyncHandler(SearchController.searchCourses));
module.exports = router;
