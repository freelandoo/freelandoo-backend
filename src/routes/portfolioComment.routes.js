const { Router } = require("express");
const PortfolioCommentController = require("../controllers/PortfolioCommentController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Lista pública dos comentários de um item de portfólio.
router.get(
  "/items/:id_portfolio_item/comments",
  asyncHandler(PortfolioCommentController.list),
);

// Criar comentário (autenticado).
router.post(
  "/items/:id_portfolio_item/comments",
  authMiddleware,
  asyncHandler(PortfolioCommentController.create),
);

// Remover comentário próprio (ou via admin).
router.delete(
  "/comments/:id_portfolio_comment",
  authMiddleware,
  asyncHandler(PortfolioCommentController.remove),
);

module.exports = router;
