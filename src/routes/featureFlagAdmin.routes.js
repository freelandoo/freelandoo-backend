const { Router } = require("express");
const FeatureFlagController = require("../controllers/FeatureFlagController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const adminGuard = [authMiddleware, roleMiddleware("Administrator")];

// Painel de Controle: lista e liga/desliga as responsabilidades.
router.get("/", adminGuard, asyncHandler(FeatureFlagController.listAdmin));
router.put("/:key", adminGuard, asyncHandler(FeatureFlagController.update));

module.exports = router;
