const { Router } = require("express");
const SearchController = require("../controllers/SearchController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", asyncHandler(SearchController.search));
module.exports = router;
