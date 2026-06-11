const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CasaParticipantController = require("../controllers/CasaParticipantController");
const CasaStoreController = require("../controllers/CasaStoreController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Publico (sem auth)
router.get("/participants", asyncHandler(CasaParticipantController.listPublic));
router.get("/store/products", asyncHandler(CasaStoreController.listPublic));
router.get("/participants/:slug", asyncHandler(CasaParticipantController.getPublicBySlug));

// Ranking da Audiencia: interacoes sempre usam a conta user logada.
router.get("/audience/summary", authMiddleware, asyncHandler(CasaParticipantController.audienceSummary));
router.get(
  "/audience/:external_user_id/interaction",
  authMiddleware,
  asyncHandler(CasaParticipantController.getAudienceInteraction),
);
router.post(
  "/audience/:external_user_id/like",
  authMiddleware,
  asyncHandler(CasaParticipantController.toggleAudienceLike),
);
router.post(
  "/audience/:external_user_id/comments",
  authMiddleware,
  asyncHandler(CasaParticipantController.createAudienceComment),
);
router.post(
  "/audience/comments/:comment_id/like",
  authMiddleware,
  asyncHandler(CasaParticipantController.toggleAudienceCommentLike),
);
router.delete(
  "/audience/comments/:comment_id",
  authMiddleware,
  asyncHandler(CasaParticipantController.deleteAudienceComment),
);

// Conveniencia Views: compra exige login (identidade Freelandoo).
router.post("/checkout", authMiddleware, asyncHandler(CasaParticipantController.createProductCheckout));
router.get("/orders", authMiddleware, asyncHandler(CasaParticipantController.listMyOrders));

module.exports = router;
