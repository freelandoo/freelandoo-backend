const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const StoreGovernanceController = require("../controllers/StoreGovernanceController");

const router = Router();

// Preview do preço final ao comprador a partir do valor que o vendedor recebe.
// Usado pelo modal de cadastro e pelo cliente para mostrar breakdown.
router.get("/price-preview", authMiddleware, asyncHandler(StoreGovernanceController.pricePreview));

module.exports = router;
