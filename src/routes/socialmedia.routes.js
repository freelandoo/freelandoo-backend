const { Router } = require("express");
const SocialMediaController = require("../controllers/SocialMediaController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.post("/", asyncHandler(SocialMediaController.upsert));
router.put(
  "/:id_social_media_type",
  asyncHandler(SocialMediaController.updateByType)
);
router.delete(
  "/:id_social_media_type",
  asyncHandler(SocialMediaController.disableByType)
);

module.exports = router;
