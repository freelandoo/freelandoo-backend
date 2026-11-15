// Baú de doação (mig 460): repasses para o admin pagar (PIX), como os outros.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const FeedBauService = require("../services/FeedBauService");
const { sendServiceResult } = require("../utils/sendServiceResult");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];
router.get("/payouts", ...admin, asyncHandler(async (req, res) => sendServiceResult(res, await FeedBauService.adminList(req.query || {}))));
router.post(
  "/payouts/:id_payout/mark-paid",
  ...admin,
  asyncHandler(async (req, res) => sendServiceResult(res, await FeedBauService.adminMarkPaid(req.params.id_payout, req.body?.note)))
);

module.exports = router;
