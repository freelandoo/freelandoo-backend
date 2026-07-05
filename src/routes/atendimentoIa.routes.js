const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const AtendimentoIaController = require("../controllers/AtendimentoIaController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// A flag `atendimento_ia_venda` é kill-switch de VENDA: só o checkout exige.
// Assinante existente continua gerenciando (GET/config/cancel) com a flag off.
router.get("/", authMiddleware, asyncHandler(AtendimentoIaController.getMine));
router.post(
  "/checkout",
  authMiddleware,
  requireFeature("atendimento_ia_venda"),
  asyncHandler(AtendimentoIaController.createCheckout)
);
router.patch("/config", authMiddleware, asyncHandler(AtendimentoIaController.updateConfig));
router.post("/cancel", authMiddleware, asyncHandler(AtendimentoIaController.cancel));

module.exports = router;
