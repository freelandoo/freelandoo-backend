const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadConversationAudio");

// Aceita os MIMEs que MediaRecorder costuma produzir cross-browser.
// O backend ainda valida o MIME real via file-type antes de comprimir.
const allowedTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/m4a",
  "audio/aac",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
]);

const uploadConversationAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB hard cap (mesma regra do frontend)
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    // Alguns browsers mandam só "audio/webm;codecs=opus" — normaliza.
    const base = mt.split(";")[0].trim();
    if (!allowedTypes.has(base)) {
      log.warn("rejected_type", { mimetype: file.mimetype });
      return cb(new Error("Formato de áudio não permitido"));
    }
    cb(null, true);
  },
});

module.exports = uploadConversationAudio;
