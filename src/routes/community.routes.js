const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CommunityController = require("../controllers/CommunityController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/eligibility",
  authMiddleware,
  asyncHandler(CommunityController.getCreationEligibility)
);

// Bundle R$100 (+1 criar / +1 entrar). Antes das rotas /:id_profile.
router.post(
  "/slots/checkout",
  authMiddleware,
  asyncHandler(CommunityController.createSlotCheckout)
);

// Votação de liderança. Antes das rotas /:id_profile.
router.get(
  "/votes/pending",
  authMiddleware,
  asyncHandler(CommunityController.listPendingVotes)
);

router.post(
  "/votes/:id_vote/ballot",
  authMiddleware,
  asyncHandler(CommunityController.castBallot)
);

router.post("/", authMiddleware, asyncHandler(CommunityController.create));

router.patch(
  "/:id_profile/theme",
  authMiddleware,
  asyncHandler(CommunityController.updateTheme)
);

router.post(
  "/:id_profile/join",
  authMiddleware,
  asyncHandler(CommunityController.join)
);

router.post(
  "/:id_profile/leave",
  authMiddleware,
  asyncHandler(CommunityController.leave)
);

module.exports = router;
