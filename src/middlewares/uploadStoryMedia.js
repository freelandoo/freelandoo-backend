// Fallback do upload presigned da câmera/composer: recebe a MESMA mídia que
// iria direto pro R2 (vídeo MP4 final ou foto/poster WebP) quando o browser
// não consegue fazer o PUT direto (bucket sem CORS). Limites espelham os do
// presign (StoryService: MAX_VIDEO_BYTES 80MB / imagem 8MB validada no service).
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadStoryMedia");

const storage = multer.memoryStorage();
const allowedTypes = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/webp",
]);

const uploadStoryMedia = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    if (!allowedTypes.has(mt)) {
      log.warn("rejected_type", { mimetype: file.mimetype });
      return cb(new Error("Tipo de arquivo nao permitido"));
    }
    cb(null, true);
  },
});

module.exports = uploadStoryMedia;
