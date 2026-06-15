const { Router } = require("express");
const CommunityController = require("../controllers/CommunityController");
const asyncHandler = require("../utils/asyncHandler");

// Comunidades são públicas/indexadas: leitura sem autenticação.
const router = Router();

router.get("/", asyncHandler(CommunityController.listPublic));
router.get("/:id_profile", asyncHandler(CommunityController.getById));
router.get(
  "/:id_profile/members",
  asyncHandler(CommunityController.getMembers)
);
router.get(
  "/:id_profile/feed",
  asyncHandler(CommunityController.getFeed)
);
router.get(
  "/:id_profile/benchmark",
  asyncHandler(CommunityController.getBenchmark)
);
router.get(
  "/:id_profile/goal",
  asyncHandler(CommunityController.getGoal)
);
router.get(
  "/:id_profile/announcements",
  asyncHandler(CommunityController.listAnnouncements)
);

module.exports = router;
