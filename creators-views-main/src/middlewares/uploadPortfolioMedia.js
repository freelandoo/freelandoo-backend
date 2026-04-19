// src/middlewares/uploadPortfolioMedia.js
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadPortfolioMedia");

const storage = multer.memoryStorage();

const uploadPortfolioMedia = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (ajuste)
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();

    const ok =
      mt.startsWith("image/") ||
      mt.startsWith("video/") ||
      mt.startsWith("application/");

    if (!ok) {
      log.warn("rejected_type", { mimetype: file.mimetype });
      return cb(new Error("Tipo de arquivo não permitido"));
    }
    cb(null, true);
  },
});

module.exports = uploadPortfolioMedia;
