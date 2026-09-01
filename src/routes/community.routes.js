const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const requireFeature = require("../middlewares/requireFeature");
const CommunityController = require("../controllers/CommunityController");
const CommunitySiteController = require("../controllers/CommunitySiteController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/eligibility",
  authMiddleware,
  asyncHandler(CommunityController.getCreationEligibility)
);

router.get("/me", authMiddleware, asyncHandler(CommunityController.listMine));

// Bundle R$100 (+1 criar / +1 entrar). Antes das rotas /:id_profile.
router.post(
  "/slots/checkout",
  authMiddleware,
  asyncHandler(CommunityController.createSlotCheckout)
);

// Votação de liderança. Antes das rotas /:id_profile.
router.get(
  "/votes/pending",
  authMiddleware,
  asyncHandler(CommunityController.listPendingVotes)
);

router.post(
  "/votes/:id_vote/ballot",
  authMiddleware,
  asyncHandler(CommunityController.castBallot)
);

router.post("/", authMiddleware, asyncHandler(CommunityController.create));

router.patch(
  "/:id_profile/theme",
  authMiddleware,
  asyncHandler(CommunityController.updateTheme)
);

// Privacidade (público/privado + mensalidade) — só líder; flag no Painel.
router.patch(
  "/:id_profile/privacy",
  authMiddleware,
  requireFeature("comunidade_privada"),
  asyncHandler(CommunityController.updatePrivacy)
);

// Entrada paga em comunidade privada (assinatura mensal Stripe).
router.post(
  "/:id_profile/membership/checkout",
  authMiddleware,
  requireFeature("comunidade_privada"),
  asyncHandler(CommunityController.createMembershipCheckout)
);

// Resumo das mensalidades (só líder).
router.get(
  "/:id_profile/membership/summary",
  authMiddleware,
  asyncHandler(CommunityController.getMembershipSummary)
);

// Edição de perfil da comunidade (só líder; guard no service).
router.patch(
  "/:id_profile/profile",
  authMiddleware,
  asyncHandler(CommunityController.updateProfile)
);

router.post(
  "/:id_profile/banner",
  authMiddleware,
  uploadAvatar.single("banner"),
  asyncHandler(CommunityController.uploadBanner)
);

router.post(
  "/:id_profile/avatar",
  authMiddleware,
  uploadAvatar.single("avatar"),
  asyncHandler(CommunityController.uploadAvatar)
);

// Metas coletivas (só líder).
router.put(
  "/:id_profile/goal",
  authMiddleware,
  asyncHandler(CommunityController.setGoal)
);
router.delete(
  "/:id_profile/goal",
  authMiddleware,
  asyncHandler(CommunityController.clearGoal)
);

// Mural do líder (só líder).
router.post(
  "/:id_profile/announcements",
  authMiddleware,
  asyncHandler(CommunityController.createAnnouncement)
);
router.delete(
  "/:id_profile/announcements/:id_announcement",
  authMiddleware,
  asyncHandler(CommunityController.deleteAnnouncement)
);

// Faixa de bees da comunidade (mig 208): os bees publicados no mural daqui,
// vivos pela MESMA regra do resto do site (24h + 1h por ponto, teto 7 dias).
router.get(
  "/:id_profile/bees",
  authMiddleware,
  asyncHandler(CommunityController.listBees)
);

// Feed estilo grupo: liga (membro) / desliga (autor ou líder) um post.
router.post(
  "/:id_profile/feed",
  authMiddleware,
  asyncHandler(CommunityController.linkFeedItem)
);
router.delete(
  "/:id_profile/feed/:id_portfolio_item",
  authMiddleware,
  asyncHandler(CommunityController.unlinkFeedItem)
);

// Recado: nota só-texto no feed da comunidade (membro publica; autor/líder apaga).
router.post(
  "/:id_profile/recado",
  authMiddleware,
  asyncHandler(CommunityController.createRecado)
);
router.delete(
  "/:id_profile/recado/:id_feed_item",
  authMiddleware,
  asyncHandler(CommunityController.deleteRecado)
);

// ─── "Meu Site" da comunidade (mig 212) ──────────────────────────────────────
// Escrita do construtor visual. Só o líder (guard no service) e só com a flag
// `comunidade_site` ligada — a flag barra EDITAR e PUBLICAR; a leitura do site
// já publicado fica fora dela (em communityPublic.routes), pela mesma razão que
// GET /me/spaces não tem requireFeature: desligar o kill-switch segura o que
// ainda não nasceu, não derruba o que já está no ar.
router.put(
  "/:id_profile/site",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.save)
);

router.post(
  "/:id_profile/site/publish",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.setPublished)
);

// Imagem do construtor (banner de hero, foto de serviço, galeria). Mesmo
// middleware de imagem do avatar/banner: 12 MB, JPG/PNG/WebP.
router.post(
  "/:id_profile/site/media",
  authMiddleware,
  requireFeature("comunidade_site"),
  uploadAvatar.single("file"),
  asyncHandler(CommunitySiteController.uploadMedia)
);

router.post(
  "/:id_profile/join",
  authMiddleware,
  asyncHandler(CommunityController.join)
);

router.post(
  "/:id_profile/leave",
  authMiddleware,
  asyncHandler(CommunityController.leave)
);

module.exports = router;
