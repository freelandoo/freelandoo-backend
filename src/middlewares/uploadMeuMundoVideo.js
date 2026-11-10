// Lore v2 F5: upload do admin — vídeo de capítulo/personagem do Meu Mundo
// (campo "video": MP4/WebM) e a imagem de capa (campo "poster": WebP/PNG/JPEG).
// memoryStorage: os bytes vão para o R2 no service (ensureFileBuffer mesmo assim).
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadMeuMundoVideo");

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = { video: ["video/mp4", "video/webm"], poster: ["image/webp", "image/png", "image/jpeg"] };

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 2 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (!(ALLOWED[file.fieldname] || []).includes(mime)) {
      log.warn("rejected", { field: file.fieldname, mimetype: file.mimetype });
      return cb(new Error(file.fieldname === "poster" ? "Imagem não aceita. Envie WebP, PNG ou JPEG." : "Vídeo não aceito. Envie MP4 ou WebM."));
    }
    cb(null, true);
  },
}).fields([
  { name: "video", maxCount: 1 },
  { name: "poster", maxCount: 1 },
]);
