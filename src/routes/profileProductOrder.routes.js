const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const ProfileProductOrderController = require("../controllers/ProfileProductOrderController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Só a NOVA compra é bloqueada quando a Loja está desligada. As leituras de
// pedidos/vendas/etiqueta ficam abertas para pedidos já em andamento liquidarem
// e continuarem rastreáveis.
router.post("/orders/checkout", authMiddleware, requireFeature("store"), asyncHandler(ProfileProductOrderController.createCheckout));
router.get("/orders", authMiddleware, asyncHandler(ProfileProductOrderController.listMyOrders));
router.get("/orders/:id_order/label", authMiddleware, asyncHandler(ProfileProductOrderController.getLabel));
// Retirada (mig 264): o vendedor marca que o comprador já buscou. Sem flag —
// é o fechamento de um pedido já pago.
router.post("/orders/:id_order/picked-up", authMiddleware, asyncHandler(ProfileProductOrderController.markPickedUp));
router.get("/sales", authMiddleware, asyncHandler(ProfileProductOrderController.listMySales));

module.exports = router;
