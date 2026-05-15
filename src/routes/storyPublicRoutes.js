const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const StoryController = require("../controllers/StoryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/feed", authMiddleware, asyncHandler(StoryController.getFeed));

router.get(
  "/by-profile/:id_profile",
  authMiddleware,
  asyncHandler(StoryController.getByProfile)
);

router.post(
  "/:id_story/view",
  authMiddleware,
  asyncHandler(StoryController.markViewed)
);

module.exports = router;
