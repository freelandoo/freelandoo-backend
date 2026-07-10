// src/routes/beeRoutes.js
// Timeline + engajamento dos bees (stories v2). Paths de comentário espelham
// /portfolio/items/:id/comments pra o CommentsPanel do front ser drop-in
// (só troca o apiBase de /api/portfolio pra /api/bees).
//
// ⚠️ Ordem: rotas literais (/timeline, /bookmarks, /events, /items, /comments,
// /admin) SEMPRE antes de qualquer rota paramétrica GET /:id_story (que deve
// ficar POR ÚLTIMO no arquivo).
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const BeeController = require("../controllers/BeeController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Timeline ranqueada (mix 60/25/15 compartilhado com o feed) + Salvos
router.get("/timeline", authMiddleware, asyncHandler(BeeController.timeline));
router.get("/bookmarks", authMiddleware, asyncHandler(BeeController.listBookmarked));

// Eventos (share — dedupe por sessão)
router.post("/events", optionalAuthMiddleware, asyncHandler(BeeController.recordEvent));

// Comentários (espelho do padrão portfolioComment.routes.js)
router.get("/items/:id_story/comments", optionalAuthMiddleware, asyncHandler(BeeController.listComments));
router.post("/items/:id_story/comments", authMiddleware, asyncHandler(BeeController.createComment));
router.post("/comments/:id_story_comment/like", authMiddleware, asyncHandler(BeeController.toggleCommentLike));
router.delete("/comments/:id_story_comment", authMiddleware, asyncHandler(BeeController.deleteComment));

// Admin — denúncias de bee (listagem simples; admin é pt-only, sem i18n)
router.get("/admin/reports", [authMiddleware, roleMiddleware("Administrator")], asyncHandler(BeeController.adminListReported));
router.post("/admin/:id_story/remove", [authMiddleware, roleMiddleware("Administrator")], asyncHandler(BeeController.adminRemove));
router.post("/admin/:id_story/resolve", [authMiddleware, roleMiddleware("Administrator")], asyncHandler(BeeController.adminResolve));

// Engajamento por bee
router.post("/:id_story/like", authMiddleware, asyncHandler(BeeController.toggleLike));
router.post("/:id_story/report", authMiddleware, asyncHandler(BeeController.report));
router.post("/:id_story/bookmark", authMiddleware, asyncHandler(BeeController.toggleBookmark));

// Bee único (deep-link ?bee= do /bees, Salvos, notificações) — SEMPRE por
// último: é a única GET paramétrica e capturaria /timeline, /bookmarks etc.
router.get("/:id_story", authMiddleware, asyncHandler(BeeController.getOne));

module.exports = router;
