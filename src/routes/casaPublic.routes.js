const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CasaParticipantController = require("../controllers/CasaParticipantController");
const CasaStoreController = require("../controllers/CasaStoreController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público (sem auth)
router.get("/participants", asyncHandler(CasaParticipantController.listPublic));
router.get("/store/products", asyncHandler(CasaStoreController.listPublic));
router.get("/participants/:slug", asyncHandler(CasaParticipantController.getPublicBySlug));

// Conveniência Views — compra exige login (identidade Freelandoo)
router.post("/checkout", authMiddleware, asyncHandler(CasaParticipantController.createProductCheckout));
router.get("/orders", authMiddleware, asyncHandler(CasaParticipantController.listMyOrders));

module.exports = router;
