const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const rateLimit = require("../middlewares/rateLimit");
const CompressController = require("../controllers/CompressController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Ferramenta /comprimir — aba Vídeo. Auth obrigatória (ffmpeg é caro; evita abuso).
// Passo 1: presigned PUT pro R2 (upload direto, não passa pelo backend).
router.post(
  "/upload-url",
  authMiddleware,
  rateLimit.upload,
  asyncHandler(CompressController.createUploadUrl)
);
// Passo 2: backend baixa do R2, comprime via ffmpeg e devolve link de download.
router.post(
  "/from-upload",
  authMiddleware,
  rateLimit.upload,
  asyncHandler(CompressController.processFromUpload)
);

module.exports = router;
