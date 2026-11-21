// src/routes/walletBanks.routes.js
//
// Bancos conectados na Carteira (mig 462) + extrato OFX/CSV (grátis).
// O webhook da Malvo NÃO mora aqui: está em webhooks.routes.js (corpo cru,
// antes do express.json global e do rate limit).
const { Router } = require("express");
const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const { sendServiceResult } = require("../utils/sendServiceResult");
const BankConnectionService = require("../services/BankConnectionService");
const BankAccessService = require("../services/BankAccessService");
const FeatureFlagService = require("../services/FeatureFlagService");

const router = Router();
const send = (fn) => asyncHandler(async (req, res) => sendServiceResult(res, await fn(req)));

// A tela: acesso, preço, limites, conexões e contas.
router.get("/me/wallet/banks", authMiddleware, send((req) => BankConnectionService.getMine(req.user)));

// Assinatura (cartão recorrente ou Pix de 1 mês). A venda segue a flag; o
// admin não compra (tem acesso pelo papel).
router.post(
  "/me/wallet/banks/checkout",
  authMiddleware,
  asyncHandler(async (req, res) => {
    let on = false;
    try {
      on = await FeatureFlagService.isEnabled("bancos_conectados");
    } catch {
      on = false;
    }
    if (!on) return res.status(403).json({ error: "Recurso indisponível no momento.", feature_disabled: "bancos_conectados" });
    return sendServiceResult(res, await BankAccessService.createCheckout(req.user, req.body));
  })
);
router.post("/me/wallet/banks/cancel", authMiddleware, send((req) => BankAccessService.cancel(req.user)));

// Conectar / reconectar / registrar o que o widget criou / desconectar.
router.post("/me/wallet/banks/connect-token", authMiddleware, send((req) => BankConnectionService.createConnectToken(req.user, req.body)));
router.post("/me/wallet/banks/items", authMiddleware, send((req) => BankConnectionService.registerItem(req.user, req.body)));
router.delete("/me/wallet/banks/:id", authMiddleware, send((req) => BankConnectionService.disconnect(req.user, req.params.id)));

// Extrato OFX/CSV — texto do arquivo no JSON (limite próprio, maior que o global).
router.post(
  "/me/wallet/finance/import",
  express.json({ limit: "4mb" }),
  authMiddleware,
  send((req) => BankConnectionService.importStatement(req.user, req.body))
);

// Admin: régua da venda (preço, bancos por pessoa, conexões por mês).
router.get(
  "/admin/wallet/banks/settings",
  authMiddleware,
  roleMiddleware("Administrator"),
  send(() => BankAccessService.getSettings())
);
router.put(
  "/admin/wallet/banks/settings",
  authMiddleware,
  roleMiddleware("Administrator"),
  send((req) => BankAccessService.updateSettings(req.user, req.body))
);

module.exports = router;
