const { Router } = require("express");
const PremiumController = require("../controllers/PremiumController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/quote/:profileId", asyncHandler(PremiumController.quote));
router.post("/checkout/polens/:profileId", authMiddleware, asyncHandler(PremiumController.checkoutPolens));
router.post("/checkout/stripe/:profileId", authMiddleware, asyncHandler(PremiumController.checkoutStripe));

module.exports = router;
