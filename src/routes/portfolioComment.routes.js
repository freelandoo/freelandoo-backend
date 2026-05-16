const { Router } = require("express");
const PortfolioCommentController = require("../controllers/PortfolioCommentController");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Lista pública dos comentários de um item de portfólio.
// Auth opcional para preencher viewer_has_liked quando logado.
router.get(
  "/items/:id_portfolio_item/comments",
  optionalAuthMiddleware,
  asyncHandler(PortfolioCommentController.list),
);

// Criar comentário (autenticado).
router.post(
  "/items/:id_portfolio_item/comments",
  authMiddleware,
  asyncHandler(PortfolioCommentController.create),
);

// Toggle de like em comentário (autenticado).
router.post(
  "/comments/:id_portfolio_comment/like",
  authMiddleware,
  asyncHandler(PortfolioCommentController.like),
);

// Remover comentário próprio (ou via admin).
router.delete(
  "/comments/:id_portfolio_comment",
  authMiddleware,
  asyncHandler(PortfolioCommentController.remove),
);

module.exports = router;
