const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadProfileAvatar");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

module.exports = async function uploadProfileAvatarToR2({ id_profile, file }) {
  log.info("upload.start", { id_profile, mimetype: file?.mimetype });
  const fileExt = getFileExt(file.originalname);
  const fileName = `profile-avatars/${id_profile}-${crypto.randomUUID()}.${fileExt}`;

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
