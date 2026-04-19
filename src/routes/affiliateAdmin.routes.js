const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const AffiliateAdminController = require("../controllers/AffiliateAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Affiliates
router.get("/", ...admin, asyncHandler(AffiliateAdminController.list));
router.post("/", ...admin, asyncHandler(AffiliateAdminController.upsert));
router.patch("/:id/status", ...admin, asyncHandler(AffiliateAdminController.updateStatus));

// Settings (versionado)
router.get("/settings", ...admin, asyncHandler(AffiliateAdminController.listSettings));
router.post("/settings", ...admin, asyncHandler(AffiliateAdminController.createSettings));

// Coupon override
router.put("/coupons/:id_coupon/override", ...admin, asyncHandler(AffiliateAdminController.upsertOverride));
router.delete("/coupons/:id_coupon/override", ...admin, asyncHandler(AffiliateAdminController.deleteOverride));

// Conversions
router.get("/conversions", ...admin, asyncHandler(AffiliateAdminController.listConversions));

// Governance
router.get("/overview", ...admin, asyncHandler(AffiliateAdminController.overview));
router.get("/audit", ...admin, asyncHandler(AffiliateAdminController.listAudit));
router.post("/conversions/:id_conversion/resolve-dispute", ...admin, asyncHandler(AffiliateAdminController.resolveDispute));

// Payouts
router.get("/payouts/eligible", ...admin, asyncHandler(AffiliateAdminController.listEligible));
router.get("/payouts", ...admin, asyncHandler(AffiliateAdminController.listBatches));
router.post("/payouts", ...admin, asyncHandler(AffiliateAdminController.createBatch));
router.get("/payouts/:id_batch", ...admin, asyncHandler(AffiliateAdminController.getBatch));
router.patch("/payouts/:id_batch/status", ...admin, asyncHandler(AffiliateAdminController.updateBatchStatus));

module.exports = router;
