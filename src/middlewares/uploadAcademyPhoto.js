// src/middlewares/uploadAcademyPhoto.js
// Foto do cadastro na academia (PUT /partner/v1/members/:id/foto-academia):
// campo multipart `foto`, JPG/PNG/WebP, até 5 MB, em memória.
const multer = require("multer");

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.includes(String(file.mimetype || "").toLowerCase())) {
      const err = new Error("formato_invalido");
      err.code = "FORMATO_INVALIDO";
      return cb(err);
    }
    return cb(null, true);
  },
});

/** Envolve o multer para responder no formato do contrato do parceiro. */
function uploadAcademyPhoto(req, res, next) {
  upload.single("foto")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ erro: "foto_grande_demais" });
    if (err.code === "FORMATO_INVALIDO") return res.status(415).json({ erro: "formato_invalido" });
    return res.status(400).json({ erro: "upload_invalido" });
  });
}

module.exports = uploadAcademyPhoto;
module.exports.ALLOWED = ALLOWED;
