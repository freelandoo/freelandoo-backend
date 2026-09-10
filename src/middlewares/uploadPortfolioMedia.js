const fs = require("fs");
const multer = require("multer");
const { createLogger } = require("../utils/logger");

const log = createLogger("uploadPortfolioMedia");

// ⚠️ DISCO, NÃO MEMÓRIA — e essa é a mudança que destrava a composição no
// servidor. O celular passou a mandar o arquivo ORIGINAL (um 4K de 70s passa
// dos 200MB) em vez de um vídeo já re-codificado por ele; com memoryStorage
// cada upload desses ficaria inteiro no heap do Node, e dois simultâneos
// derrubariam o container. Em disco, o ffmpeg lê o arquivo direto e a memória
// do processo não vê os bytes.
//
// Quem ainda manda mídia já pronta (clientes antigos, outras superfícies)
// continua funcionando: o service lê o arquivo para Buffer nesse caminho.
const storage = multer.diskStorage({});

// 400MB cobre 70s de 4K de celular. Os tetos REAIS por tipo continuam onde
// sempre estiveram (30MB para imagem, 100MB para vídeo já composto) — este
// número é só a porteira do multipart, e afrouxá-lo não afrouxa nenhum deles.
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/** Regra de tipo aceito. Exportada para poder ser exercitada sem subir servidor. */
function isAllowedUploadType(mimetype) {
  return allowedTypes.has(String(mimetype || "").toLowerCase());
}

const uploadPortfolioMedia = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();

    if (!isAllowedUploadType(mt)) {
      log.warn("rejected_type", { mimetype: file.mimetype, field: file.fieldname });
      return cb(new Error("Tipo de arquivo nao permitido"));
    }
    cb(null, true);
  },
});

// `file` é a mídia; `overlay` é o PNG com o que foi desenhado por cima (texto,
// vinheta, sobreposição de imagem) e `pip` é o vídeo sobreposto. Os dois
// últimos só chegam quando o cliente pede composição no servidor.
const FIELDS = [
  { name: "file", maxCount: 1 },
  { name: "overlay", maxCount: 1 },
  { name: "pip", maxCount: 1 },
];

/**
 * Recebe os três campos e reapresenta o principal como `req.file`, que é o que
 * os controllers sempre leram — assim ninguém a jusante precisa saber que a
 * porta passou a aceitar mais coisa.
 *
 * ⚠️ APAGA OS TEMPORÁRIOS QUANDO A RESPOSTA FECHA, e é aqui que isso tem que
 * morar: em disco, um upload que falha no meio (403, item inexistente, erro do
 * ffmpeg) deixaria o arquivo para trás, e num container que sobe e desce o
 * bastante isso enche o /tmp em silêncio. No `finally` do service não bastaria
 * — nem todo caminho de erro chega lá.
 */
function withComposeParts(req, res, next) {
  uploadPortfolioMedia.fields(FIELDS)(req, res, (err) => {
    const paths = [];
    for (const arr of Object.values(req.files || {})) {
      for (const f of arr || []) if (f?.path) paths.push(f.path);
    }
    if (paths.length) {
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const p of paths) fs.unlink(p, () => {});
      };
      res.on("finish", cleanup);
      res.on("close", cleanup);
    }

    if (err) return next(err);

    const f = req.files || {};
    req.file = f.file?.[0] || null;
    req.overlayFile = f.overlay?.[0] || null;
    req.pipFile = f.pip?.[0] || null;
    next();
  });
}

module.exports = uploadPortfolioMedia;
module.exports.withComposeParts = withComposeParts;
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
module.exports.isAllowedUploadType = isAllowedUploadType;
