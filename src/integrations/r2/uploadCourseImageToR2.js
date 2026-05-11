// src/integrations/r2/uploadCourseImageToR2.js
//
// Sobe imagens "editoriais" de curso (banner de módulo, capa de aula) para R2.
// Usado pelos endpoints POST /modules/:id/banner e POST /lessons/:id/cover.
// Imagens 16:9 ou 4:5 são apenas convenção do frontend — aqui o arquivo é
// armazenado como veio (sem ffmpeg/sharp). O frontend valida proporções
// com preview antes do envio.

const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadCourseImage");

function getFileExt(originalname = "") {
  const parts = String(originalname).split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

const VALID_KINDS = new Set(["course-cover", "module-banner", "lesson-cover"]);

const PREFIX_BY_KIND = {
  "course-cover": "course-covers",
  "module-banner": "course-module-banners",
  "lesson-cover": "course-lesson-covers",
};

module.exports = async function uploadCourseImageToR2({
  file,
  kind,
  courseId,
  resourceId,
}) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`Tipo de imagem inválido: ${kind}`);
  }
  log.info("upload.start", { kind, courseId, resourceId, mimetype: file?.mimetype });

  const prefix = PREFIX_BY_KIND[kind];
  const fileExt = getFileExt(file.originalname);
  // Estrutura: prefix/<courseId>/<resourceId>-<random>.<ext>
  // Facilita auditoria/limpeza por curso e descarta arquivo trocado sem
  // sobrescrever (o storage referencia a URL nova, a antiga vira órfã —
  // mesma política do resto do projeto).
  const fileName = `${prefix}/${courseId}/${resourceId}-${crypto.randomUUID()}.${fileExt}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  const url = `${process.env.R2_PUBLIC_URL}/${fileName}`;
  log.info("upload.ok", { key: fileName });
  return url;
};
