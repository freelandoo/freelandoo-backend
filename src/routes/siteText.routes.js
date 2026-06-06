const { Router } = require("express");
const SiteTextController = require("../controllers/SiteTextController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público: mapa slot_key -> content (as home leem isso).
router.get("/", asyncHandler(SiteTextController.listPublic));

module.exports = router;
