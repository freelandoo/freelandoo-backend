const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadCommunitySiteAsset");

// Extensões aceitas. O middleware já barra mimetype fora de JPG/PNG/WebP; aqui
// a lista existe porque a extensão vem do NOME do arquivo, que é do usuário —
// deixá-la passar crua colocaria ".html" numa key de bucket público.
const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Imagem do construtor de site da comunidade → prefixo `community-sites/`.
 *
 * A key leva o id_profile no caminho para que o dono de cada arquivo seja
 * legível direto no bucket (e uma limpeza futura por comunidade seja um
 * prefixo, não uma varredura).
 */
module.exports = async function uploadCommunitySiteAssetToR2({ id_profile, file }) {
  log.info("upload.start", { id_profile, mimetype: file?.mimetype });

  const ext = EXT_BY_MIME[(file.mimetype || "").toLowerCase()] || "jpg";
  const fileName = `community-sites/${id_profile}/${crypto.randomUUID()}.${ext}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  const url = `${process.env.R2_PUBLIC_URL}/${fileName}`;
  log.info("upload.ok", { key: fileName });
  return url;
};
