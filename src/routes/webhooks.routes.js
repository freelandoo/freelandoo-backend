const { Router } = require("express");
const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const StripeController = require("../controllers/StripeController");

const router = Router();

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  asyncHandler(StripeController.handleWebhook)
);

module.exports = router;
