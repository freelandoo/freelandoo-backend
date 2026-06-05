const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const ProtectionTestService = require("../services/ProtectionTestService");
const { sendServiceResult } = require("../utils/sendServiceResult");

// Painel TEMPORÁRIO de teste da Proteção de Pagamento. Admin + env gate.
// Montado em /admin/protection-test.
const router = Router();
const guard = [authMiddleware, roleMiddleware("Administrator")];

const h = (fn) => asyncHandler(async (req, res) => sendServiceResult(res, await fn(req)));

router.get("/products", guard, h((req) => ProtectionTestService.myProducts(req.user)));
router.get("/state", guard, h((req) => ProtectionTestService.getState(req.user, req.query.order_id)));
router.post("/seed", guard, h((req) => ProtectionTestService.seed(req.user, req.body?.id_profile_product)));
router.post("/ship", guard, h((req) => ProtectionTestService.simulateShipment(req.user, req.body?.order_id)));
router.post("/advance-window", guard, h((req) => ProtectionTestService.advanceWindow(req.user, req.body?.order_id)));
router.post("/dispute", guard, h((req) => ProtectionTestService.openDispute(req.user, req.body?.order_id, req.body?.reason_code, req.body?.description)));
router.post("/reverse-delivered", guard, h((req) => ProtectionTestService.simulateReverseDelivered(req.user, req.body?.order_id)));
router.post("/not-arrived-refund", guard, h((req) => ProtectionTestService.simulateNotArrivedRefund(req.user, req.body?.order_id)));
router.post("/admin-resolve", guard, h((req) => ProtectionTestService.adminResolve(req.user, req.body?.order_id, req.body?.action, req.body?.note)));
router.post("/cleanup", guard, h((req) => ProtectionTestService.cleanup(req.user)));

module.exports = router;
