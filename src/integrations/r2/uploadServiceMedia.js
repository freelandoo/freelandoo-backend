const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadServiceMedia");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

function safeName(name = "") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function buildKey(id_profile, id_profile_service, originalname, suffix = "") {
  const fileExt = getFileExt(originalname);
  const base = safeName(originalname || "").replace(/\.[^.]+$/, "") || "media";
  const tag = suffix ? `-${suffix}` : "";
  return `service-media/${id_profile}/${id_profile_service}/${base}${tag}-${crypto.randomUUID()}.${fileExt}`;
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

module.exports = async function uploadServiceMediaToR2({ id_profile, id_profile_service, file }) {
  log.info("upload.start", {
    id_profile,
    id_profile_service,
    mimetype: file?.mimetype,
    hasThumbnail: !!file?.thumbnail,
  });

  const key = buildKey(id_profile, id_profile_service, file.originalname);
  await putObject(key, file.buffer, file.mimetype);
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;

  let thumbnail_url = null;
  let thumbnail_key = null;
  if (file?.thumbnail?.buffer?.length) {
    const thumbKey = buildKey(
      id_profile,
      id_profile_service,
      file.thumbnail.originalname || file.originalname,
      "thumb"
    );
    try {
      await putObject(thumbKey, file.thumbnail.buffer, file.thumbnail.mimetype);
      thumbnail_url = `${process.env.R2_PUBLIC_URL}/${thumbKey}`;
      thumbnail_key = thumbKey;
    } catch (err) {
      log.warn("upload.thumbnail_failed", { err: err?.message });
    }
  }

  log.info("upload.ok", { key, thumbnail_key });
  return { url, key, thumbnail_url, thumbnail_key };
};
