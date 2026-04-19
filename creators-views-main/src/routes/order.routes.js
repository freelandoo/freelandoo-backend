const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const OrderController = require("../controllers/OrderController");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", authMiddleware, asyncHandler(OrderController.listMyOrders));

router.get(
  "/:id_order",
  authMiddleware,
  asyncHandler(OrderController.getOrderById)
);

router.patch(
  "/:id_order/cancel",
  authMiddleware,
  asyncHandler(OrderController.cancelOrder)
);

module.exports = router;
