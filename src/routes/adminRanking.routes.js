const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const RankingController = require("../controllers/RankingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/rankings", ...admin, asyncHandler(RankingController.adminGetRankings));
router.get("/ranking-config", ...admin, asyncHandler(RankingController.adminGetConfig));
router.put("/ranking-config", ...admin, asyncHandler(RankingController.adminUpdateConfig));
router.post("/ranking/recalculate", ...admin, asyncHandler(RankingController.adminRecalculate));

module.exports = router;
