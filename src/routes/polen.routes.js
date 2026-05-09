const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const PolenController = require("../controllers/PolenController");

const router = Router();
const auth = [authMiddleware];

router.get("/wallet", ...auth, asyncHandler(PolenController.wallet));
router.get("/history", ...auth, asyncHandler(PolenController.history));
router.post("/rewarded-ad/request", ...auth, asyncHandler(PolenController.requestRewardedAd));
router.post("/rewarded-ad/complete", ...auth, asyncHandler(PolenController.completeRewardedAd));
router.post("/spend", ...auth, asyncHandler(PolenController.spend));

module.exports = router;
