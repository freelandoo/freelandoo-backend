const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const ProtectionController = require("../controllers/ProtectionController");

// Montado em /admin/disputes. Fila de disputas + detalhe + resolução.
const router = Router();
const guard = [authMiddleware, roleMiddleware("Administrator")];

router.get("/", guard, asyncHandler(ProtectionController.adminListDisputes));
router.get("/:id", guard, asyncHandler(ProtectionController.adminDisputeDetail));
router.post("/:id/resolve", guard, asyncHandler(ProtectionController.adminResolveDispute));

module.exports = router;
