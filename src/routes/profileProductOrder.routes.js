const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ProfileProductOrderController = require("../controllers/ProfileProductOrderController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post("/orders/checkout", authMiddleware, asyncHandler(ProfileProductOrderController.createCheckout));
router.get("/orders", authMiddleware, asyncHandler(ProfileProductOrderController.listMyOrders));
router.get("/orders/:id_order/label", authMiddleware, asyncHandler(ProfileProductOrderController.getLabel));
router.get("/sales", authMiddleware, asyncHandler(ProfileProductOrderController.listMySales));

module.exports = router;
