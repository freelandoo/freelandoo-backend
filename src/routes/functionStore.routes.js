const { Router } = require("express");
const FunctionStoreController = require("../controllers/FunctionStoreController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Vitrine pública da Loja de Funções (carrossel /funcoes) — sem auth: a posse
// (owned) vem de GET /users/me/features, não daqui.
router.get("/products", asyncHandler(FunctionStoreController.listProducts));
router.get("/products/:key", asyncHandler(FunctionStoreController.getProduct));

// Compra (Stripe one-time, vitalícia).
router.post(
  "/products/:key/checkout",
  authMiddleware,
  asyncHandler(FunctionStoreController.createCheckout)
);

module.exports = router;
