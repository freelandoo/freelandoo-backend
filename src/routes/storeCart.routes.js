// /store-carts — o carrinho da Loja (mig 271). PORTA ANÔNIMA: quem compra não
// precisa de conta. `optionalAuthMiddleware` liga o pedido à conta quando há
// sessão; sem ela, o pedido vive pelos dados digitados.
//
// ⚠️ Sem login, quem segurava a enxurrada era a conta — por isso o limite
// `checkout` (mesma decisão do agendamento sem conta, mig 244). Ele é por IP e
// não substitui a dona cancelar o que for falso.
const { Router } = require("express");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const rateLimit = require("../middlewares/rateLimit");
const StoreCartController = require("../controllers/StoreCartController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post(
  "/checkout",
  requireFeature("store"),
  rateLimit.checkout,
  optionalAuthMiddleware,
  asyncHandler(StoreCartController.checkout)
);
// O recibo fica FORA da flag: desligar a Loja não pode esconder de quem já
// pagou o estado do próprio pedido.
router.get("/:id_cart", asyncHandler(StoreCartController.getPublic));

module.exports = router;
