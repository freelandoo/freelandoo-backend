// src/integrations/r2/uploadPortfolioMedia.js
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadPortfolioMedia");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

function safeName(name = "") {
  // simples: remove espaços e caracteres estranhos
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function buildKey(id_profile, id_portfolio_item, originalname, suffix = "") {
  const fileExt = getFileExt(originalname);
  const original = safeName(originalname || "");
  const base = original ? original.replace(/\.[^.]+$/, "") : "media";
  const tag = suffix ? `-${suffix}` : "";
  return `portfolio/${id_profile}/${id_portfolio_item}/${base}${tag}-${crypto.randomUUID()}.${fileExt}`;
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

module.exports = async function uploadPortfolioMediaToR2({
  id_profile,
  id_portfolio_item,
  file,
}) {
  log.info("upload.start", {
    id_profile,
    id_portfolio_item,
    mimetype: file?.mimetype,
    hasThumbnail: !!file?.thumbnail,
  });

  const fileName = buildKey(id_profile, id_portfolio_item, file.originalname);
  await putObject(fileName, file.buffer, file.mimetype);
  const url = `${process.env.R2_PUBLIC_URL}/${fileName}`;

  let thumbnail_url = null;
  let thumbnail_key = null;
  if (file?.thumbnail?.buffer?.length) {
    const thumbName = buildKey(
      id_profile,
      id_portfolio_item,
      file.thumbnail.originalname || file.originalname,
      "thumb"
    );
    try {
      await putObject(thumbName, file.thumbnail.buffer, file.thumbnail.mimetype);
      thumbnail_url = `${process.env.R2_PUBLIC_URL}/${thumbName}`;
      thumbnail_key = thumbName;
    } catch (err) {
      // Thumbnail é best-effort — não bloqueia o upload do vídeo.
      log.warn("upload.thumbnail_failed", { err: err?.message });
    }
  }

  log.info("upload.ok", { key: fileName, thumbnail_key });
  return { url, key: fileName, thumbnail_url, thumbnail_key };
};
