const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const RankingController = require("../controllers/RankingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Públicos
router.post("/visit", asyncHandler(RankingController.recordVisit));
router.get("/ratings/:id_profile", asyncHandler(RankingController.getRatings));
router.get("/public/profile/:id_profile", asyncHandler(RankingController.getPublicProfilePosition));
router.get("/public/machine/:id_machine", asyncHandler(RankingController.getTopByMachine));
router.get("/public/general", asyncHandler(RankingController.getTopGeneral));
router.get("/public/city", asyncHandler(RankingController.getTopByCity));
router.get("/public/profession/:profession_slug", asyncHandler(RankingController.getTopByProfession));
router.get("/public/clans/general", asyncHandler(RankingController.getTopClansGeneral));
router.get("/public/clans/machine/:id_machine", asyncHandler(RankingController.getTopClansByMachine));

// Autenticados (opcionalmente autenticado para visitas com user_id)
router.post("/like", authMiddleware, asyncHandler(RankingController.toggleLike));
router.get("/likes/:id_profile", authMiddleware, asyncHandler(RankingController.getLikedItems));
router.post("/rating", authMiddleware, asyncHandler(RankingController.upsertRating));
router.get("/can-rate/:id_profile", authMiddleware, asyncHandler(RankingController.canRate));
router.post("/heartbeat", authMiddleware, asyncHandler(RankingController.heartbeat));
router.get("/engagement/:id_profile", authMiddleware, asyncHandler(RankingController.getEngagement));

module.exports = router;
