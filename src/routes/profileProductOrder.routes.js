const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ProfileProductOrderController = require("../controllers/ProfileProductOrderController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post("/checkout", authMiddleware, asyncHandler(ProfileProductOrderController.createCheckout));
router.get("/", authMiddleware, asyncHandler(ProfileProductOrderController.listMyOrders));

module.exports = router;
