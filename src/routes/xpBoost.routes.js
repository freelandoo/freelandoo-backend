const { Router } = require("express");
const XpBoostController = require("../controllers/XpBoostController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Booster de XP (nível 5): cria a sessão de checkout Stripe (R$10).
router.post("/checkout", authMiddleware, asyncHandler(XpBoostController.createCheckout));

module.exports = router;
