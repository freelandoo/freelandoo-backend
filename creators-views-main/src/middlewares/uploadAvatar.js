const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadAvatar");

const storage = multer.memoryStorage();

const uploadAvatar = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      log.warn("rejected_non_image", { mimetype: file.mimetype });
      return cb(new Error("Apenas imagens são permitidas"));
    }
    cb(null, true);
  },
});

module.exports = uploadAvatar;
