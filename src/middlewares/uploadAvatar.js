const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadAvatar");

const storage = multer.memoryStorage();

const uploadAvatar = multer({
  storage,
  limits: {
    fileSize: 12 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes((file.mimetype || "").toLowerCase())) {
      log.warn("rejected_non_image", { mimetype: file.mimetype });
      return cb(new Error("Formato nao aceito. Envie JPG, PNG ou WebP."));
    }
    cb(null, true);
  },
});

module.exports = uploadAvatar;
