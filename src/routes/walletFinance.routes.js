const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const WalletFinanceController = require("../controllers/WalletFinanceController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Categorias (presets + custom) — antes da rota com :id pra não colidir.
router.get("/me/wallet/finance/categories", authMiddleware, asyncHandler(WalletFinanceController.listCategories));
router.post("/me/wallet/finance/categories", authMiddleware, asyncHandler(WalletFinanceController.createCategory));

// Visão do mês + CRUD de lançamentos.
// ANTES da rota do mês e das de :id — caminho fixo tem que ser declarado antes
// do parâmetro, senão "received-in" seria lido como um id.
router.get(
  "/me/wallet/finance/received-in",
  authMiddleware,
  asyncHandler(WalletFinanceController.receivedInTotal)
);
router.get("/me/wallet/finance", authMiddleware, asyncHandler(WalletFinanceController.getMonth));
router.post("/me/wallet/finance", authMiddleware, asyncHandler(WalletFinanceController.createEntry));
router.patch("/me/wallet/finance/:id", authMiddleware, asyncHandler(WalletFinanceController.updateEntry));
router.delete("/me/wallet/finance/:id", authMiddleware, asyncHandler(WalletFinanceController.deleteEntry));

module.exports = router;
