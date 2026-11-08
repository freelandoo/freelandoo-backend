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
// A7: histórico da Esmeralda e a troca Gold → Esmeralda (o contrário não existe).
router.get("/emerald/history", ...auth, asyncHandler(PolenController.emeraldHistory));
router.post("/convert", ...auth, asyncHandler(PolenController.convert));
router.get("/coupons", ...auth, asyncHandler(PolenController.myCoupons));
router.post("/coupons", ...auth, asyncHandler(PolenController.buyCoupon));

module.exports = router;
