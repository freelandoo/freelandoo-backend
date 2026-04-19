const { Router } = require("express");
const SocialMediaPublicController = require("../controllers/SocialMediaPublicController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/meta", asyncHandler(SocialMediaPublicController.getMeta));
router.get("/types", asyncHandler(SocialMediaPublicController.listTypes));
router.get(
  "/follower-ranges",
  asyncHandler(SocialMediaPublicController.listFollowerRanges)
);

module.exports = router;
