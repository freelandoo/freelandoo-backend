const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const FraudAdminController = require("../controllers/FraudAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Painel de Fraude (mig 201). Sem gate de feature flag: painel de admin é
// sempre acessível (mesma convenção dos clusters de live).
// As rotas literais vêm ANTES de /:id_review, senão ela captura "payouts".
router.get("/dashboard", ...admin, asyncHandler(FraudAdminController.dashboard));
router.get("/queue", ...admin, asyncHandler(FraudAdminController.queue));
router.get("/payout-mismatches", ...admin, asyncHandler(FraudAdminController.payoutMismatches));
router.post("/users/:id_user/reevaluate", ...admin, asyncHandler(FraudAdminController.reevaluate));

router.get("/:id_review", ...admin, asyncHandler(FraudAdminController.detail));
router.post("/:id_review/decide", ...admin, asyncHandler(FraudAdminController.decide));

module.exports = router;
