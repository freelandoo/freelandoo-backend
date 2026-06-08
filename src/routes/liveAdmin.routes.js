const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const LiveAdminController = require("../controllers/LiveAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Loja de presentes das Lives
router.get("/gifts", ...admin, asyncHandler(LiveAdminController.listGifts));
router.post("/gifts", ...admin, asyncHandler(LiveAdminController.createGift));
router.put("/gifts/:id", ...admin, asyncHandler(LiveAdminController.updateGift));
router.delete("/gifts/:id", ...admin, asyncHandler(LiveAdminController.deleteGift));

module.exports = router;
