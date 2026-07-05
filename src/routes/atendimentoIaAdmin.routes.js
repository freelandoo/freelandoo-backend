const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const AtendimentoIaController = require("../controllers/AtendimentoIaController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
router.use(authMiddleware, roleMiddleware("Administrator"));

// Planos (preço + limite de tokens por ciclo).
router.get("/plans", asyncHandler(AtendimentoIaController.adminListPlans));
router.post("/plans", asyncHandler(AtendimentoIaController.adminCreatePlan));
router.patch("/plans/:id_plan", asyncHandler(AtendimentoIaController.adminUpdatePlan));
router.delete("/plans/:id_plan", asyncHandler(AtendimentoIaController.adminDeletePlan));

// Assinantes + re-provisionamento manual.
router.get("/subs", asyncHandler(AtendimentoIaController.adminListSubs));
router.post("/subs/:id_sub/reprovision", asyncHandler(AtendimentoIaController.adminReprovision));

module.exports = router;
