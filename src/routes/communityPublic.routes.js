const { Router } = require("express");
const CommunityController = require("../controllers/CommunityController");
const CommunitySiteController = require("../controllers/CommunitySiteController");
const CommunityDomainController = require("../controllers/CommunityDomainController");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

// Comunidades são públicas/indexadas: leitura sem autenticação.
const router = Router();

// Auth opcional: a lista é pública, mas o recorte depende do viewer — membro
// vê os contadores da própria comunidade privada/condomínio; forasteiro não.
router.get("/", optionalAuthMiddleware, asyncHandler(CommunityController.listPublic));
// Resolução de domínio próprio → slug (mig 214). Chamada pelo middleware do
// front a cada visita vinda de domínio de comunidade. Sem auth: quem chega por
// domínio próprio não tem sessão nossa. Devolve só domain/slug/id — nada do
// conteúdo, que é buscado depois pela porta de slug com as travas de sempre.
router.get(
  "/site/resolve-host",
  asyncHandler(CommunityDomainController.resolveHost)
);

// Porta PÚBLICA do site pelo endereço próprio (mig 213): `/c/<slug>`.
// Vem ANTES de `/:id_profile` pela convenção do arquivo — uma rota de segmento
// fixo tem que ser declarada antes da paramétrica que poderia engoli-la.
// SEM auth de propósito: é a porta que buscador, link de WhatsApp e domínio
// próprio usam. A trava de privacidade está no service, não aqui.
router.get(
  "/site/by-slug/:slug",
  asyncHandler(CommunitySiteController.getPublicBySlug)
);

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

// "Meu Site" (mig 212). Auth OPCIONAL: site publicado é página pública e
// indexável, mas o service ainda recorta — rascunho só o líder vê, e site de
// comunidade privada/condomínio obedece à MESMA trava do resto do conteúdo
// interno. Sem o viewer aqui, o líder não conseguiria abrir o próprio rascunho.
router.get(
  "/:id_profile/site",
  optionalAuthMiddleware,
  asyncHandler(CommunitySiteController.get)
);

// Próximo horário livre da equipe (mig 221) — a agenda viva do cartão de
// chamada e da página de agendar. Fica FORA do payload do site de propósito: a
// página pública é servida com ISR de 10 minutos, e um horário embutido nela
// seria anunciado por até 10 minutos depois de a vaga ter sido tomada.
router.get(
  "/:id_profile/site/next-slot",
  optionalAuthMiddleware,
  asyncHandler(CommunitySiteController.getNextSlot)
);

module.exports = router;
