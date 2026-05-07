const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadPortfolioMedia");

const storage = multer.memoryStorage();
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const uploadPortfolioMedia = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();

    if (!allowedTypes.has(mt)) {
      log.warn("rejected_type", { mimetype: file.mimetype });
      return cb(new Error("Tipo de arquivo nao permitido"));
    }
    cb(null, true);
  },
});

module.exports = uploadPortfolioMedia;
