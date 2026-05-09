const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const ManifestationAdminController = require("../controllers/ManifestationAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Categories
router.get("/categories", ...admin, asyncHandler(ManifestationAdminController.listCategories));
router.post("/categories", ...admin, asyncHandler(ManifestationAdminController.createCategory));
router.put("/categories/:id", ...admin, asyncHandler(ManifestationAdminController.updateCategory));
router.delete("/categories/:id", ...admin, asyncHandler(ManifestationAdminController.deleteCategory));

// Products
router.get("/products", ...admin, asyncHandler(ManifestationAdminController.listProducts));
router.get("/products/:id", ...admin, asyncHandler(ManifestationAdminController.getProduct));
router.post(
  "/products",
  ...admin,
  uploadAvatar.single("banner"),
  asyncHandler(ManifestationAdminController.createProduct)
);
router.put(
  "/products/:id",
  ...admin,
  uploadAvatar.single("banner"),
  asyncHandler(ManifestationAdminController.updateProduct)
);
router.delete("/products/:id", ...admin, asyncHandler(ManifestationAdminController.deleteProduct));
router.post("/products/:id/feature", ...admin, asyncHandler(ManifestationAdminController.featureProduct));
router.delete("/products/:id/feature", ...admin, asyncHandler(ManifestationAdminController.unfeatureProduct));

// Standalone banner upload (útil quando admin quer subir antes de criar o produto)
router.post(
  "/uploads/banner",
  ...admin,
  uploadAvatar.single("banner"),
  asyncHandler(ManifestationAdminController.uploadBanner)
);

module.exports = router;
