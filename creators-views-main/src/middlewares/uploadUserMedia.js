const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadUserMedia");

const storage = multer.memoryStorage();

const uploadMedia = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    if (
      !file.mimetype.startsWith("image/") &&
      !file.mimetype.startsWith("video/")
    ) {
      log.warn("rejected_type", { mimetype: file.mimetype });
      return cb(new Error("Apenas imagens ou vídeos são permitidos"));
    }
    cb(null, true);
  },
});

module.exports = uploadMedia;
