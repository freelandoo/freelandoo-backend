const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const MonetizationIntentController = require("../controllers/MonetizationIntentController");

const router = Router();

router.get("/status",   authMiddleware, asyncHandler(MonetizationIntentController.status));
router.post("/choose",  authMiddleware, asyncHandler(MonetizationIntentController.choose));
router.post("/dismiss", authMiddleware, asyncHandler(MonetizationIntentController.dismiss));

module.exports = router;
