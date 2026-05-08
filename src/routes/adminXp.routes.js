const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const XpController = require("../controllers/XpController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/xp-settings", ...admin, asyncHandler(XpController.adminGetSettings));
router.put("/xp-settings", ...admin, asyncHandler(XpController.adminUpdateSettings));

module.exports = router;
