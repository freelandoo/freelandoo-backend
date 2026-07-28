const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadFunctionProductImage");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

// Imagem do card do produto da Loja de Funções (prefixo próprio no bucket único).
module.exports = async function uploadFunctionProductImage({ file }) {
  log.info("upload.start", { mimetype: file?.mimetype });
  const fileExt = getFileExt(file.originalname);
  const fileName = `function-store/card-${crypto.randomUUID()}.${fileExt}`;

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
