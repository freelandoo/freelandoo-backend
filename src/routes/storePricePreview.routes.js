const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const requireFeature = require("../middlewares/requireFeature");
const StoreGovernanceController = require("../controllers/StoreGovernanceController");

const router = Router();

// Preview de preço da Loja — gated junto com a responsabilidade.
router.use(requireFeature("store"));

// Preview do preço final ao comprador a partir do valor que o vendedor recebe.
// Usado pelo modal de cadastro e pelo cliente para mostrar breakdown.
router.get("/price-preview", authMiddleware, asyncHandler(StoreGovernanceController.pricePreview));

module.exports = router;
