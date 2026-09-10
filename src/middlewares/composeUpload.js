// src/middlewares/composeUpload.js
//
// Fábrica dos uploads que aceitam COMPOSIÇÃO NO SERVIDOR.
//
// Uma porta dessas recebe três coisas: a mídia principal, o PNG com o que foi
// desenhado por cima (texto, vinheta, sobreposição de imagem) e, quando existe,
// o vídeo de PiP. É a mesma forma no portfólio (post/Curto) e no story, e por
// isso mora aqui: escrita duas vezes, a limpeza dos temporários acabaria
// existindo só numa delas — e o defeito não apareceria em revisão nenhuma, só
// no dia em que o /tmp do container enchesse.
//
// ⚠️ DISCO, NÃO MEMÓRIA. O celular passou a mandar o arquivo ORIGINAL (um 4K de
// 70s passa de 200MB) em vez de um vídeo já re-codificado por ele. Com
// memoryStorage cada upload desses ficaria inteiro no heap do Node, e dois
// simultâneos derrubariam o container. Em disco, o ffmpeg lê o arquivo direto e
// o processo nunca vê os bytes.

const fs = require("fs");
const multer = require("multer");
const { createLogger } = require("../utils/logger");

/** 400MB cobre 70s de 4K de celular. Os tetos REAIS por tipo continuam onde
 *  sempre estiveram (30MB para imagem, 100MB para vídeo já composto) — este
 *  número é só a porteira do multipart, e afrouxá-lo não afrouxa nenhum deles. */
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;

/**
 * @param {object} cfg
 *  - name         : nome do logger
 *  - mainField    : campo da mídia principal ("file", "video", ...)
 *  - allowedTypes : Set de mimetypes aceitos na mídia principal
 *  - overlayTypes : Set de mimetypes aceitos no PNG/PiP (default: png + vídeo)
 *  - maxBytes     : teto do multipart
 */
function createComposeUpload(cfg) {
  const log = createLogger(cfg.name);
  const mainField = cfg.mainField || "file";
  const allowed = cfg.allowedTypes;
  const overlayAllowed =
    cfg.overlayTypes ||
    new Set(["image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"]);
  const maxBytes = cfg.maxBytes || MAX_UPLOAD_BYTES;

  function isAllowedUploadType(field, mimetype) {
    const mt = String(mimetype || "").toLowerCase();
    // ⚠️ O campo importa: o `overlay` é sempre PNG e nunca deveria aceitar os
    // mesmos tipos da mídia principal. Uma lista só para todos os campos
    // deixaria a porta do overlay mais larga do que precisa ser.
    return field === mainField ? allowed.has(mt) : overlayAllowed.has(mt);
  }

  const upload = multer({
    storage: multer.diskStorage({}),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      if (!isAllowedUploadType(file.fieldname, file.mimetype)) {
        log.warn("rejected_type", { mimetype: file.mimetype, field: file.fieldname });
        return cb(new Error("Tipo de arquivo nao permitido"));
      }
      cb(null, true);
    },
  });

  const FIELDS = [
    { name: mainField, maxCount: 1 },
    { name: "overlay", maxCount: 1 },
    { name: "pip", maxCount: 1 },
  ];

  /**
   * Recebe os três campos e reapresenta o principal como `req.file`, que é o
   * que os controllers sempre leram — assim ninguém a jusante precisa saber que
   * a porta passou a aceitar mais coisa.
   *
   * ⚠️ APAGA OS TEMPORÁRIOS QUANDO A RESPOSTA FECHA, e é aqui que isso tem que
   * morar: em disco, um upload que falha no meio (403, item inexistente, erro
   * do ffmpeg) deixaria o arquivo para trás. No `finally` do service não
   * bastaria — nem todo caminho de erro chega lá.
   */
  function withComposeParts(req, res, next) {
    upload.fields(FIELDS)(req, res, (err) => {
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
      req.file = f[mainField]?.[0] || null;
      req.overlayFile = f.overlay?.[0] || null;
      req.pipFile = f.pip?.[0] || null;
      next();
    });
  }

  return { upload, withComposeParts, isAllowedUploadType, MAX_UPLOAD_BYTES: maxBytes };
}

module.exports = { createComposeUpload, MAX_UPLOAD_BYTES };
