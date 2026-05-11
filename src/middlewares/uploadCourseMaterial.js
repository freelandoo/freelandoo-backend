const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadCourseMaterial");

const storage = multer.memoryStorage();

// 25MB cap (Slice 9). PDFs e imagens. ZIP/docs fora do escopo inicial.
const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const uploadCourseMaterial = multer({
  storage,
  limits: {
    fileSize: MAX_BYTES,
  },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    if (!ALLOWED.has(mime)) {
      log.warn("rejected_mime", { mimetype: file.mimetype });
      return cb(
        new Error("Formato nao aceito. Envie PDF, JPG, PNG, WebP ou GIF."),
      );
    }
    cb(null, true);
  },
});

module.exports = uploadCourseMaterial;
