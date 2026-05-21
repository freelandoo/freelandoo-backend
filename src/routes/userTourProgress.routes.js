const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const UserTourProgressController = require("../controllers/UserTourProgressController");

const router = Router();

router.get("/progress", authMiddleware, asyncHandler(UserTourProgressController.list));
router.post("/start", authMiddleware, asyncHandler(UserTourProgressController.start));
router.post("/complete", authMiddleware, asyncHandler(UserTourProgressController.complete));
router.post("/skip", authMiddleware, asyncHandler(UserTourProgressController.skip));
router.post("/reset", authMiddleware, asyncHandler(UserTourProgressController.reset));
router.post("/settings", authMiddleware, asyncHandler(UserTourProgressController.updateSettings));

module.exports = router;
