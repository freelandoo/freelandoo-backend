const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const RankingController = require("../controllers/RankingController");
const RankingSocialController = require("../controllers/RankingSocialController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Públicos
// /visit usa auth OPCIONAL: anônimo registra visita s/ XP; logado popula
// req.user e concede XP de visita (dedup diário por par user+perfil).
router.post("/visit", optionalAuthMiddleware, asyncHandler(RankingController.recordVisit));
router.get("/ratings/:id_profile", asyncHandler(RankingController.getRatings));
router.get("/public/profile/:id_profile", asyncHandler(RankingController.getPublicProfilePosition));
router.get("/public/machine/:id_machine", asyncHandler(RankingController.getTopByMachine));
router.get("/public/general", asyncHandler(RankingController.getTopGeneral));
router.get("/public/city", asyncHandler(RankingController.getTopByCity));
router.get("/public/region", asyncHandler(RankingController.getTopByRegion));
router.get("/public/profession/:profession_slug", asyncHandler(RankingController.getTopByProfession));
router.get("/public/clans/general", asyncHandler(RankingController.getTopClansGeneral));
router.get("/public/clans/machine/:id_machine", asyncHandler(RankingController.getTopClansByMachine));
router.get("/public/seasons", asyncHandler(RankingController.getSeasons));
router.get("/public/seasons/:season_number", asyncHandler(RankingController.getSeasonChampions));

// Social do ranking (likes/comentarios sobre perfis listados no /ranking).
// Leitura publica (viewer opcional); escrita sempre pela conta user logada.
// As rotas literais /social/comments/* vem ANTES de /social/:id_profile/*
// para o :id_profile nao capturar o segmento "comments".
router.get("/social/summary", optionalAuthMiddleware, asyncHandler(RankingSocialController.summary));
router.post(
  "/social/comments/:comment_id/like",
  authMiddleware,
  asyncHandler(RankingSocialController.toggleCommentLike),
);
router.delete(
  "/social/comments/:comment_id",
  authMiddleware,
  asyncHandler(RankingSocialController.deleteComment),
);
router.get(
  "/social/:id_profile/comments",
  optionalAuthMiddleware,
  asyncHandler(RankingSocialController.getInteraction),
);
router.post(
  "/social/:id_profile/comments",
  authMiddleware,
  asyncHandler(RankingSocialController.createComment),
);
router.post(
  "/social/:id_profile/like",
  authMiddleware,
  asyncHandler(RankingSocialController.toggleProfileLike),
);

// Autenticados (opcionalmente autenticado para visitas com user_id)
router.post("/like", authMiddleware, asyncHandler(RankingController.toggleLike));
router.get("/likes/:id_profile", authMiddleware, asyncHandler(RankingController.getLikedItems));
router.post("/rating", authMiddleware, asyncHandler(RankingController.upsertRating));
router.get("/can-rate/:id_profile", authMiddleware, asyncHandler(RankingController.canRate));
router.post("/heartbeat", authMiddleware, asyncHandler(RankingController.heartbeat));
router.get("/engagement/:id_profile", authMiddleware, asyncHandler(RankingController.getEngagement));

module.exports = router;
