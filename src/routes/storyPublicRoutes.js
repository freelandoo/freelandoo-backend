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

// StoryBar v2 (agrupada por user): bees vivos de todos os subperfis do user.
router.get(
  "/by-user/:id_user",
  authMiddleware,
  asyncHandler(StoryController.getByUser)
);

router.post(
  "/:id_story/view",
  authMiddleware,
  asyncHandler(StoryController.markViewed)
);

router.post(
  "/:id_story/react",
  authMiddleware,
  asyncHandler(StoryController.react)
);

module.exports = router;
