const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadVaquinhaMedia");

function getFileExt(originalname = "") {
  const parts = String(originalname).split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

function buildKey(id_vaquinha, originalname, suffix = "") {
  const fileExt = getFileExt(originalname);
  const tag = suffix ? `-${suffix}` : "";
  return `vaquinha-posts/${id_vaquinha}/${crypto.randomUUID()}${tag}.${fileExt}`;
}

async function putObject(key, body, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

// Sobe uma mídia já processada (imagem 4:5 ou vídeo vertical) para o prefixo
// vaquinha-posts/<id_vaquinha>/. Retorna URLs públicas.
module.exports = async function uploadVaquinhaMediaToR2({ id_vaquinha, file }) {
  const key = buildKey(id_vaquinha, file.originalname);
  await putObject(key, file.buffer, file.mimetype);
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;

  let thumbnail_url = null;
  if (file?.thumbnail?.buffer?.length) {
    const thumbKey = buildKey(id_vaquinha, file.thumbnail.originalname || file.originalname, "thumb");
    try {
      await putObject(thumbKey, file.thumbnail.buffer, file.thumbnail.mimetype);
      thumbnail_url = `${process.env.R2_PUBLIC_URL}/${thumbKey}`;
    } catch (err) {
      log.warn("upload.thumbnail_failed", { err: err?.message });
    }
  }
  return { url, thumbnail_url };
};
