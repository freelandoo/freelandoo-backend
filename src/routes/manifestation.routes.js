const { Router } = require("express");
const ManifestationController = require("../controllers/ManifestationController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/products", asyncHandler(ManifestationController.listProducts));
router.get("/products/:id", asyncHandler(ManifestationController.getProduct));
router.get("/me", authMiddleware, asyncHandler(ManifestationController.mine));
router.post("/checkout/polens", authMiddleware, asyncHandler(ManifestationController.checkoutPolens));
router.post("/checkout/stripe", authMiddleware, asyncHandler(ManifestationController.checkoutStripe));
router.post("/apply", authMiddleware, asyncHandler(ManifestationController.apply));
router.post("/remove", authMiddleware, asyncHandler(ManifestationController.remove));
router.put("/profiles/:profileId/apply", authMiddleware, asyncHandler(ManifestationController.setProfileApply));

module.exports = router;
