const { Router } = require("express");
const ProfileProductController = require("../controllers/ProfileProductController");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

// Loja/Produtos desligada → some a vitrine pública de produtos.
router.use(requireFeature("store"));

router.get("/:id_profile/products", asyncHandler(ProfileProductController.listPublic));
router.get("/:id_profile/products/:id_profile_product", asyncHandler(ProfileProductController.getPublicById));
router.post(
  "/:id_profile/products/:id_profile_product/shipping",
  asyncHandler(ProfileProductController.quoteShipping)
);

module.exports = router;
