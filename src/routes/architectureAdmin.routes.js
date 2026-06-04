const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const ArchitectureAdminController = require("../controllers/ArchitectureAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Resumo / KPIs
router.get("/summary", ...admin, asyncHandler(ArchitectureAdminController.summary));

// Inventário de funções
router.get("/functions", ...admin, asyncHandler(ArchitectureAdminController.listFunctions));
router.get("/functions/:id", ...admin, asyncHandler(ArchitectureAdminController.getFunction));
router.patch("/functions/:id", ...admin, asyncHandler(ArchitectureAdminController.updateFunction));

// Recarrega o manifesto (scan) para dentro do inventário
router.post("/sync", ...admin, asyncHandler(ArchitectureAdminController.sync));

// Logs de rota
router.get("/logs", ...admin, asyncHandler(ArchitectureAdminController.listLogs));
router.get("/logs/summary", ...admin, asyncHandler(ArchitectureAdminController.logsSummary));
router.delete("/logs", ...admin, asyncHandler(ArchitectureAdminController.purgeLogs));

module.exports = router;
