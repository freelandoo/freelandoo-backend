const { Router } = require("express");
const SiteAssetController = require("../controllers/SiteAssetController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público: mapa slot_key -> image_url (as home leem isso).
router.get("/", asyncHandler(SiteAssetController.listPublic));

module.exports = router;
