const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadCourseVideo");

const storage = multer.memoryStorage();

// 100MB cap (Slice 7). Quando virar gargalo, migrar para worker queue
// e/ou upload direto para R2 (presigned). Por enquanto, síncrono no Express.
const MAX_BYTES = 100 * 1024 * 1024;

const uploadCourseVideo = multer({
  storage,
  limits: {
    fileSize: MAX_BYTES,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/webm"];
    const mime = (file.mimetype || "").toLowerCase();
    if (!allowed.includes(mime)) {
      log.warn("rejected_non_video", { mimetype: file.mimetype });
      return cb(new Error("Formato nao aceito. Envie MP4, MOV ou WebM."));
    }
    cb(null, true);
  },
});

module.exports = uploadCourseVideo;
