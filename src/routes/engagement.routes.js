const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const EngagementController = require("../controllers/EngagementController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Analytics privado do dono — sempre autenticado.
router.get("/", authMiddleware, asyncHandler(EngagementController.getEngagement));

module.exports = router;
