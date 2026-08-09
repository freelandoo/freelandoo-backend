const { Router } = require("express");
const CommunityController = require("../controllers/CommunityController");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

// Comunidades são públicas/indexadas: leitura sem autenticação.
const router = Router();

// Auth opcional: a lista é pública, mas o recorte depende do viewer — membro
// vê os contadores da própria comunidade privada/condomínio; forasteiro não.
router.get("/", optionalAuthMiddleware, asyncHandler(CommunityController.listPublic));
// Auth opcional: resolve membership/assinatura do viewer (comunidade privada).
router.get(
  "/:id_profile",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getById)
);
// Auth opcional: em condomínio a lista de moradores é restrita (mig 196) —
// o service precisa do viewer para decidir se responde ou devolve 403.
router.get(
  "/:id_profile/members",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getMembers)
);
// Auth opcional: comunidade privada só mostra o feed para membros.
router.get(
  "/:id_profile/feed",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getFeed)
);
// Auth opcional: benchmark e metas expõem posição e RANKING NOMINAL de membros —
// em privada/condomínio isso é a lista de quem está dentro (C2 do desenho macro).
router.get(
  "/:id_profile/benchmark",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getBenchmark)
);
router.get(
  "/:id_profile/goal",
  optionalAuthMiddleware,
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
