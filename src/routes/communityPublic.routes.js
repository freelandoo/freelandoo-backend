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

module.exports = router;
