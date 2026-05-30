const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadStoryVideo = require("../middlewares/uploadStoryVideo");
const StoryController = require("../controllers/StoryController");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");

const router = Router();

router.get("/", authMiddleware, asyncHandler(StoryController.listMine));

router.post(
  "/",
  authMiddleware,
  rateLimit.upload,
  uploadStoryVideo.single("video"),
  asyncHandler(StoryController.createMine)
);

// ─── Câmera in-browser (zero-servidor / GPU-local) ─────────────────────────
// Passo 1: emite presigned PUT URLs (vídeo MP4 + poster WebP) → upload direto R2.
router.post(
  "/upload-url",
  authMiddleware,
  rateLimit.upload,
  asyncHandler(StoryController.createUploadUrl)
);
// Passo 2: registra a story a partir do objeto já enviado pro R2 (só metadados).
router.post(
  "/from-upload",
  authMiddleware,
  rateLimit.upload,
  asyncHandler(StoryController.createFromUpload)
);

router.delete(
  "/:id_story",
  authMiddleware,
  asyncHandler(StoryController.deleteMine)
);

module.exports = router;
