const { Router } = require("express");
const CommunityController = require("../controllers/CommunityController");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

// Comunidades são públicas/indexadas: leitura sem autenticação.
const router = Router();

router.get("/", asyncHandler(CommunityController.listPublic));
router.get("/:id_profile", asyncHandler(CommunityController.getById));
router.get(
  "/:id_profile/members",
  asyncHandler(CommunityController.getMembers)
);
router.get(
  "/:id_profile/feed",
  asyncHandler(CommunityController.getFeed)
);
router.get(
  "/:id_profile/benchmark",
  asyncHandler(CommunityController.getBenchmark)
);
router.get(
  "/:id_profile/goal",
  asyncHandler(CommunityController.getGoal)
);
// Mural é privado (só membros) — auth opcional p/ resolver a membership.
router.get(
  "/:id_profile/announcements",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.listAnnouncements)
);
// Feed estilo grupo (posts + bees dos membros). Viewer opcional p/ "curtiu?".
router.get(
  "/:id_profile/feed-posts",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getFeedPosts)
);

module.exports = router;
