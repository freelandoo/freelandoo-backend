const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const CasaAdminController = require("../controllers/CasaAdminController");
const CasaStoreController = require("../controllers/CasaStoreController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// ─── Loja global "Conveniência Views" (produtos espelhados) ───
router.get("/store/products", ...admin, asyncHandler(CasaStoreController.list));
router.post("/store/products", ...admin, asyncHandler(CasaStoreController.create));
router.get("/store/orders", ...admin, asyncHandler(CasaStoreController.listOrders));
router.get("/store/products/:id", ...admin, asyncHandler(CasaStoreController.get));
router.put("/store/products/:id", ...admin, asyncHandler(CasaStoreController.update));
router.delete("/store/products/:id", ...admin, asyncHandler(CasaStoreController.remove));
router.post("/store/products/:id/media", ...admin, uploadAvatar.single("file"), asyncHandler(CasaStoreController.addMedia));
router.put("/store/products/:id/media/reorder", ...admin, asyncHandler(CasaStoreController.reorderMedia));
router.delete("/store/media/:mediaId", ...admin, asyncHandler(CasaStoreController.deleteMedia));

// Participantes
router.get("/participants", ...admin, asyncHandler(CasaAdminController.list));
router.post("/participants", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.create));
router.post("/uploads", ...admin, uploadAvatar.single("file"), asyncHandler(CasaAdminController.upload));
router.get("/participants/:id", ...admin, asyncHandler(CasaAdminController.get));
router.put("/participants/:id/full", ...admin, asyncHandler(CasaAdminController.saveFull));
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

module.exports = router;
