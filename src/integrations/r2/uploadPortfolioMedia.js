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

module.exports = async function uploadPortfolioMediaToR2({
  id_profile,
  id_portfolio_item,
  file,
}) {
  log.info("upload.start", {
    id_profile,
    id_portfolio_item,
    mimetype: file?.mimetype,
  });
  const fileExt = getFileExt(file.originalname);
  const original = safeName(file.originalname || "");
  const base = original ? original.replace(/\.[^.]+$/, "") : "media";

  const fileName = `portfolio/${id_profile}/${id_portfolio_item}/${base}-${crypto.randomUUID()}.${fileExt}`;

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
