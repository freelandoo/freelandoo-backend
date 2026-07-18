const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const LiveClusterController = require("../controllers/LiveClusterController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Superfície do membro (lobby /cluster). Gated pela flag live_clusters.
router.use(requireFeature("live_clusters"));

router.get("/mine", authMiddleware, asyncHandler(LiveClusterController.listMine));
// ÚLTIMA rota (param) — senão captura /mine.
router.get("/:id_live_cluster", authMiddleware, asyncHandler(LiveClusterController.detail));

module.exports = router;
