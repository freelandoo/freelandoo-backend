const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const LiveController = require("../controllers/LiveController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Lives (WebRTC/LiveKit) — todas autenticadas (espelha stories/feed).
router.get("/", authMiddleware, asyncHandler(LiveController.listActive));
router.post("/", authMiddleware, asyncHandler(LiveController.start));
router.post("/:id_live/end", authMiddleware, asyncHandler(LiveController.end));
router.post("/:id_live/join", authMiddleware, asyncHandler(LiveController.join));

module.exports = router;
