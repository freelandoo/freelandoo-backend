const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const PolenProductAdminController = require("../controllers/PolenProductAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/products", ...admin, asyncHandler(PolenProductAdminController.listProducts));
router.get("/products/:id", ...admin, asyncHandler(PolenProductAdminController.getProduct));
router.post(
  "/products",
  ...admin,
  uploadAvatar.single("image"),
  asyncHandler(PolenProductAdminController.createProduct)
);
router.put(
  "/products/:id",
  ...admin,
  uploadAvatar.single("image"),
  asyncHandler(PolenProductAdminController.updateProduct)
);
router.delete("/products/:id", ...admin, asyncHandler(PolenProductAdminController.deleteProduct));

router.post(
  "/uploads/image",
  ...admin,
  uploadAvatar.single("image"),
  asyncHandler(PolenProductAdminController.uploadImage)
);

module.exports = router;
