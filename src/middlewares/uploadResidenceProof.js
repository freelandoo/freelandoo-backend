// Comprovante de residência FILMADO (mig 206). Só vídeo: a exigência de
// filmagem é a própria defesa — um print de conta de luz se falsifica em um
// editor de imagem, um vídeo segurando o documento não.
//
// Memória, e não disco: o arquivo vai direto para o R2 e o servidor não deve
// deixar cópia de documento de terceiro no sistema de arquivos do container.
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadResidenceProof");

const allowedTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const uploadResidenceProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    if (!allowedTypes.has(mt)) {
      // O nome do arquivo não entra no log: comprovante costuma trazer o nome
      // do titular no próprio nome do arquivo.
      log.warn("rejected_type", { mimetype: file.mimetype });
      return cb(new Error("Envie um vídeo (MP4, MOV ou WebM)"));
    }
    cb(null, true);
  },
});

module.exports = uploadResidenceProof;
