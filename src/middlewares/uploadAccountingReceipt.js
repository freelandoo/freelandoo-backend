const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadAccountingReceipt");

// Comprovante de guia (mig 277): PDF ou foto do recibo. 10MB sobra — o
// comprovante do banco é um PDF de uma página.
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    if (!ALLOWED.has(mime)) {
      log.warn("rejected_mime", { mimetype: file.mimetype });
      return cb(new Error("Formato não aceito. Envie PDF, JPG, PNG ou WebP."));
    }
    cb(null, true);
  },
});
