const express = require("express");
const UserController = require("../controllers/UserController");
const UserMediaController = require("../controllers/UserMediaController");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const uploadUserMedia = require("../middlewares/uploadUserMedia");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/me", authMiddleware, asyncHandler(UserController.me));
router.put("/me", authMiddleware, asyncHandler(UserController.updateMe));

router.put(
  "/me/avatar",
  authMiddleware,
  uploadAvatar.single("avatar"),
  asyncHandler(UserController.updateAvatar)
);

router.post(
  "/me/media/upload",
  authMiddleware,
  uploadUserMedia.single("file"),
  asyncHandler(UserMediaController.uploadMedia)
);

router.get(
  "/me/media",
  authMiddleware,
  asyncHandler(UserMediaController.listMyMedia)
);
router.post(
  "/me/media",
  authMiddleware,
  asyncHandler(UserMediaController.createMedia)
);
router.put(
  "/me/media/:id_media",
  authMiddleware,
  asyncHandler(UserMediaController.updateMedia)
);
router.delete(
  "/me/media/:id_media",
  authMiddleware,
  asyncHandler(UserMediaController.deleteMedia)
);

router.get("/:id/media", asyncHandler(UserMediaController.listUserMedia));

router.get("/:id", asyncHandler(UserController.creator));

module.exports = router;
