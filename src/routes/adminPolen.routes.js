const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const PolenController = require("../controllers/PolenController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/settings", ...admin, asyncHandler(PolenController.adminSettings));
router.put("/settings", ...admin, asyncHandler(PolenController.updateAdminSettings));
router.get("/metrics", ...admin, asyncHandler(PolenController.adminMetrics));

module.exports = router;
