const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const CasaAdminController = require("../controllers/CasaAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Participantes
router.get("/participants", ...admin, asyncHandler(CasaAdminController.list));
router.post("/participants", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.create));
router.post("/uploads", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.upload));
router.get("/participants/:id", ...admin, asyncHandler(CasaAdminController.get));
router.put("/participants/:id", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.update));
router.delete("/participants/:id", ...admin, asyncHandler(CasaAdminController.remove));

// Jornada
router.post("/participants/:id/journey", ...admin, asyncHandler(CasaAdminController.createJourney));
router.put("/journey/:itemId", ...admin, asyncHandler(CasaAdminController.updateJourney));
router.delete("/journey/:itemId", ...admin, asyncHandler(CasaAdminController.deleteJourney));

// Segredos
router.post("/participants/:id/secrets", ...admin, asyncHandler(CasaAdminController.createSecret));
router.put("/secrets/:itemId", ...admin, asyncHandler(CasaAdminController.updateSecret));
router.delete("/secrets/:itemId", ...admin, asyncHandler(CasaAdminController.deleteSecret));

// Teorias
router.post("/participants/:id/theories", ...admin, asyncHandler(CasaAdminController.createTheory));
router.put("/theories/:itemId", ...admin, asyncHandler(CasaAdminController.updateTheory));
router.delete("/theories/:itemId", ...admin, asyncHandler(CasaAdminController.deleteTheory));

// Produtos (Conveniência Views)
router.get("/participants/:id/products", ...admin, asyncHandler(CasaAdminController.listProducts));
router.post("/participants/:id/products", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.createProduct));
router.put("/products/:productId", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.updateProduct));
router.delete("/products/:productId", ...admin, asyncHandler(CasaAdminController.deleteProduct));

module.exports = router;
