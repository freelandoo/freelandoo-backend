// /profile/:id_profile/product-collections — as coleções da Loja (mig 271).
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const uploadAvatar = require("../middlewares/uploadAvatar");
const ProductCollectionController = require("../controllers/ProductCollectionController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

// Mesmo interruptor do CRUD de produtos: Loja desligada, vitrine trancada.
router.use(requireFeature("store"));

router.get("/", authMiddleware, asyncHandler(ProductCollectionController.list));
router.post("/", authMiddleware, asyncHandler(ProductCollectionController.create));
router.put("/order", authMiddleware, asyncHandler(ProductCollectionController.reorder));
router.patch("/:id_collection", authMiddleware, asyncHandler(ProductCollectionController.update));
router.delete("/:id_collection", authMiddleware, asyncHandler(ProductCollectionController.remove));
router.post(
  "/:id_collection/cover",
  authMiddleware,
  uploadAvatar.single("file"),
  asyncHandler(ProductCollectionController.uploadCover)
);
router.delete("/:id_collection/cover", authMiddleware, asyncHandler(ProductCollectionController.removeCover));

module.exports = router;
