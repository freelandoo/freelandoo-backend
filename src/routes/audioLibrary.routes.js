const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const AudioTrackController = require("../controllers/AudioTrackController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público (autenticado): picker de música do composer.
router.get("/", authMiddleware, asyncHandler(AudioTrackController.listPublic));

module.exports = router;
