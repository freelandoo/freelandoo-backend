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
