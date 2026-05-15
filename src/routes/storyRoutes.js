const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadStoryVideo = require("../middlewares/uploadStoryVideo");
const StoryController = require("../controllers/StoryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", authMiddleware, asyncHandler(StoryController.listMine));

router.post(
  "/",
  authMiddleware,
  uploadStoryVideo.single("video"),
  asyncHandler(StoryController.createMine)
);

router.delete(
  "/:id_story",
  authMiddleware,
  asyncHandler(StoryController.deleteMine)
);

module.exports = router;
