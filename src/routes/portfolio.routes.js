const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const PortfolioController = require("../controllers/PortfolioController");
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/", optionalAuthMiddleware, asyncHandler(PortfolioController.listPublic));

router.post("/", authMiddleware, asyncHandler(PortfolioController.createItem));
router.patch(
  "/:id_portfolio_item",
  authMiddleware,
  asyncHandler(PortfolioController.updateItem)
);
router.delete(
  "/:id_portfolio_item",
  authMiddleware,
  asyncHandler(PortfolioController.disableItem)
);

router.post(
  "/:id_portfolio_item/media",
  authMiddleware,
  asyncHandler(PortfolioController.addMedia)
);
router.delete(
  "/:id_portfolio_item/media/:id_portfolio_media",
  authMiddleware,
  asyncHandler(PortfolioController.disableMedia)
);

router.post(
  "/:id_portfolio_item/upload",
  authMiddleware,
  uploadPortfolioMedia.single("file"),
  asyncHandler(PortfolioController.uploadMedia)
);

module.exports = router;
