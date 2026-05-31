// Upload da biblioteca de áudio: campo "audio" (mp3/aac/ogg/wav, 20MB) + campo
// opcional "cover" (jpg/png/webp). memoryStorage — bytes vão pro R2 no service.
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadAudioTrack");

const AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/aac", "audio/mp4", "audio/x-m4a",
  "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm",
]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const uploadAudioTrack = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    if (file.fieldname === "audio") {
      if (!AUDIO_TYPES.has(mt)) {
        log.warn("rejected_audio", { mimetype: file.mimetype });
        return cb(new Error("Formato de áudio não aceito. Use MP3, AAC, OGG ou WAV."));
      }
      return cb(null, true);
    }
    if (file.fieldname === "cover") {
      if (!IMAGE_TYPES.has(mt)) {
        log.warn("rejected_cover", { mimetype: file.mimetype });
        return cb(new Error("Capa deve ser JPG, PNG ou WebP."));
      }
      return cb(null, true);
    }
    return cb(null, false);
  },
}).fields([
  { name: "audio", maxCount: 1 },
  { name: "cover", maxCount: 1 },
]);

module.exports = uploadAudioTrack;
