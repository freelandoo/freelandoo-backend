const express = require("express");
const RegionController = require("../controllers/RegionController");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Público: usado pela vitrine (select de região por estado).
router.get("/", asyncHandler(RegionController.list));

module.exports = router;
