const { Router } = require("express");
const CommunityController = require("../controllers/CommunityController");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

// Comunidades são públicas/indexadas: leitura sem autenticação.
const router = Router();

router.get("/", asyncHandler(CommunityController.listPublic));
// Auth opcional: resolve membership/assinatura do viewer (comunidade privada).
router.get(
  "/:id_profile",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getById)
);
router.get(
  "/:id_profile/members",
  asyncHandler(CommunityController.getMembers)
);
// Auth opcional: comunidade privada só mostra o feed para membros.
router.get(
  "/:id_profile/feed",
  optionalAuthMiddleware,
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
// Retorno de link de share (1 ponto pro membro). Público — chamado pela rota /cs.
router.post(
  "/:id_profile/share-return",
  asyncHandler(CommunityController.logShareReturn)
);

module.exports = router;
