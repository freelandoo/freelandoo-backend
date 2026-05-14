const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const resolveUserAccountProfile = require("../middlewares/resolveUserAccountProfile");
const PortfolioController = require("../controllers/PortfolioController");
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Rotas de portfólio do USER ACCOUNT (perfil-fantasma is_user_account=TRUE).
 * Reaproveita PortfolioController inteiro injetando id_profile via middleware.
 *
 * Postagens daqui:
 *   - aparecem no feed (/feed/portfolio)
 *   - NÃO aparecem na vitrine (showcase_visible=FALSE)
 *   - NÃO aparecem nos rankings (ranking_visible=FALSE)
 */
const router = Router({ mergeParams: true });

router.use(authMiddleware);
router.use(resolveUserAccountProfile);

router.get("/", asyncHandler(PortfolioController.listPublic));
router.post("/", asyncHandler(PortfolioController.createItem));

router.patch(
  "/:id_portfolio_item",
  asyncHandler(PortfolioController.updateItem)
);
router.delete(
  "/:id_portfolio_item",
  asyncHandler(PortfolioController.disableItem)
);

router.post(
  "/:id_portfolio_item/media",
  asyncHandler(PortfolioController.addMedia)
);
router.delete(
  "/:id_portfolio_item/media/:id_portfolio_media",
  asyncHandler(PortfolioController.disableMedia)
);

router.post(
  "/:id_portfolio_item/upload",
  uploadPortfolioMedia.single("file"),
  asyncHandler(PortfolioController.uploadMedia)
);

module.exports = router;
