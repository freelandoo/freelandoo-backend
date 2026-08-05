const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const AffiliateController = require("../controllers/AffiliateController");
const StoreGovernanceController = require("../controllers/StoreGovernanceController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Trilhos da % que o dono do item pode destinar a afiliados (mig 192). Fica aqui
// (e não junto do price-preview) porque serve produto, serviço E curso — o
// price-preview é gated pela flag `store`, que não vale para cursos.
router.get("/program", authMiddleware, asyncHandler(StoreGovernanceController.affiliateProgram));

router.get("/", authMiddleware, asyncHandler(AffiliateController.getMe));
router.get("/share-coupon", authMiddleware, asyncHandler(AffiliateController.getMyShareCoupon));
router.put("/payout-info", authMiddleware, asyncHandler(AffiliateController.updateMyPayoutInfo));
router.get("/conversions", authMiddleware, asyncHandler(AffiliateController.listMyConversions));

module.exports = router;
