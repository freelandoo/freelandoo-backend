const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const SiteTextController = require("../controllers/SiteTextController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Admin salva o texto de um slot (JSON { content }).
router.post("/:slot_key", ...admin, asyncHandler(SiteTextController.upsert));

module.exports = router;
