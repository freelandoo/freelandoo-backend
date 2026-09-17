// src/middlewares/uploadKnowledgePdf.js
// Upload de PDF para a base de conhecimento do atendente.
//
// ⚠️ EM MEMÓRIA, e não em disco, de propósito. O teto é 10 MB e o arquivo é
// lido uma vez, convertido em texto e DESCARTADO — ele nunca chega ao R2 nem
// fica em `/tmp`. Em disco, seria preciso lembrar de limpar o temporário em
// TODO caminho de erro, e o que escapasse encheria o volume em silêncio.
// (O `composeUpload` usa disco porque lá o arquivo é um vídeo 4K de 200 MB.)
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadKnowledgePdf");

const uploadKnowledgePdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const tipo = String(file.mimetype || "").toLowerCase();
    // ⚠️ O mimetype vem do CLIENTE e não é prova de nada — quem prova que o
    // arquivo é PDF é o parser, em `utils/pdfText`. Este filtro só evita subir
    // 10 MB de vídeo para descobrir lá na frente.
    if (tipo !== "application/pdf") {
      log.warn("rejected_non_pdf", { mimetype: tipo });
      return cb(new Error("Envie um arquivo PDF."));
    }
    cb(null, true);
  },
});

module.exports = uploadKnowledgePdf;
