const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const FunctionStoreAdminController = require("../controllers/FunctionStoreAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Catálogo fechado: só listar/editar (função nova = código novo + seed).
router.get("/products", ...admin, asyncHandler(FunctionStoreAdminController.listProducts));
router.put(
  "/products/:id",
  ...admin,
  uploadAvatar.single("image"),
  asyncHandler(FunctionStoreAdminController.updateProduct)
);

router.get("/purchases", ...admin, asyncHandler(FunctionStoreAdminController.listPurchases));

// Concessão/revogação manual (suporte) — compra paga amount 0, provider admin_grant.
router.post("/grant", ...admin, asyncHandler(FunctionStoreAdminController.grant));
router.post("/revoke", ...admin, asyncHandler(FunctionStoreAdminController.revoke));

module.exports = router;
