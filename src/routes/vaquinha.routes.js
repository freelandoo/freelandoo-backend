const { Router } = require("express");
const VaquinhaController = require("../controllers/VaquinhaController");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Vaquinha desligada no Painel de Controle → bloqueia tudo (criação e doações).
router.use(requireFeature("vaquinha"));

// ─── Dono (auth) ───────────────────────────────────────────────────────────
router.get("/me/vaquinha", authMiddleware, asyncHandler(VaquinhaController.getMine));
router.post("/me/vaquinha", authMiddleware, asyncHandler(VaquinhaController.create));
router.post("/me/vaquinha/start", authMiddleware, asyncHandler(VaquinhaController.getOrCreate));
router.patch("/me/vaquinha/:id", authMiddleware, asyncHandler(VaquinhaController.update));
router.post("/me/vaquinha/:id/cover", authMiddleware, uploadPortfolioMedia.single("cover"), asyncHandler(VaquinhaController.uploadCover));
router.post("/me/vaquinha/:id/close", authMiddleware, asyncHandler(VaquinhaController.close));
router.post("/me/vaquinha/:id/posts", authMiddleware, uploadPortfolioMedia.single("media"), asyncHandler(VaquinhaController.createPost));
router.delete("/me/vaquinha/posts/:postId", authMiddleware, asyncHandler(VaquinhaController.deletePost));

// ─── Público ───────────────────────────────────────────────────────────────
// Auth opcional no detalhe: resolve o patrocínio do próprio viewer (bolsa).
router.get("/vaquinhas/:slug", optionalAuthMiddleware, asyncHandler(VaquinhaController.getPublic));
router.get("/vaquinhas/:slug/posts", asyncHandler(VaquinhaController.listPosts));
router.post("/vaquinhas/:slug/donate", optionalAuthMiddleware, asyncHandler(VaquinhaController.donate));

// ─── Bolsa Patrocínio (assinatura mensal; exige login) ──────────────────────
router.post("/vaquinhas/:slug/sponsor", authMiddleware, asyncHandler(VaquinhaController.sponsor));
router.post("/vaquinhas/:slug/sponsor/cancel", authMiddleware, asyncHandler(VaquinhaController.cancelSponsorship));

module.exports = router;
