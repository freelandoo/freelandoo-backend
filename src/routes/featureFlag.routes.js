const { Router } = require("express");
const FeatureFlagController = require("../controllers/FeatureFlagController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público: mapa { flag_key: is_enabled } para o front esconder superfícies.
router.get("/", asyncHandler(FeatureFlagController.publicMap));

module.exports = router;
