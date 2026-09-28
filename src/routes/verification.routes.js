// src/routes/verification.routes.js
// O SELO VERIFICADO (mig 268): R$9,90/mês.
//
//   GET  /me/verification           → estado do selo, preço e se está à venda
//   POST /me/verification/checkout  → { method: card|pix } abre o pagamento
//   POST /me/verification/cancel    → solta a renovação (fica até o fim do mês)
//   GET  /admin/verification        → régua (preço, à venda)
//   PUT  /admin/verification        → edita a régua
//
// ⚠️ A FLAG `selo_verificado` BARRA SÓ O CHECKOUT. Ler o próprio estado e
// cancelar a renovação ficam fora dela: desligar a venda não pode trancar a
// porta de saída de quem já assina.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");
const { sendServiceResult } = require("../utils/sendServiceResult");
const VerificationService = require("../services/VerificationService");

const me = Router();
me.use(authMiddleware);
me.get("/", asyncHandler(async (req, res) => sendServiceResult(res, await VerificationService.getMine(req.user))));
me.post(
  "/checkout",
  requireFeature("selo_verificado"),
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await VerificationService.createCheckout(req.user, req.body))
  )
);
me.post("/cancel", asyncHandler(async (req, res) => sendServiceResult(res, await VerificationService.cancel(req.user))));

const admin = Router();
admin.use(authMiddleware, roleMiddleware("Administrator"));
admin.get("/", asyncHandler(async (req, res) => sendServiceResult(res, await VerificationService.getSettings())));
admin.put(
  "/",
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await VerificationService.updateSettings(req.user, req.body))
  )
);

module.exports = { me, admin };
