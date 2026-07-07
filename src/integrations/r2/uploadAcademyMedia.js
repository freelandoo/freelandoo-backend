const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadAcademyMedia");

function getFileExt(originalname = "") {
  const parts = String(originalname).split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

function buildKey(id_academy, originalname, suffix = "") {
  const tag = suffix ? `-${suffix}` : "";
  return `academy-media/${id_academy}/${crypto.randomUUID()}${tag}.${getFileExt(originalname)}`;
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

// Mídia de academia (posts/avatar/capa) no prefixo academy-media/<id_academy>/.
// Superfície interna de alto volume → <img> lazy no front (política F3.S6).
// `file` pode ser output do processPortfolioMedia (com .thumbnail) ou multer cru.
module.exports = async function uploadAcademyMediaToR2({ id_academy, file }) {
  const key = buildKey(id_academy, file.originalname);
  await putObject(key, file.buffer, file.mimetype);
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;

  let thumbnail_url = null;
  if (file?.thumbnail?.buffer?.length) {
    const thumbKey = buildKey(id_academy, file.thumbnail.originalname || file.originalname, "thumb");
    try {
      await putObject(thumbKey, file.thumbnail.buffer, file.thumbnail.mimetype);
      thumbnail_url = `${process.env.R2_PUBLIC_URL}/${thumbKey}`;
    } catch (err) {
      log.warn("upload.thumbnail_failed", { err: err?.message });
    }
  }
  return { url, thumbnail_url };
};
