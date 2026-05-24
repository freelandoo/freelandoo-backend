const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadTourCard");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

module.exports = async function uploadTourCardToR2({ file, kind = "card" }) {
  log.info("upload.start", { kind, mimetype: file?.mimetype });
  const fileExt = getFileExt(file.originalname);
  const objectKey = `tour-cards/${kind}-${crypto.randomUUID()}.${fileExt}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  const url = `${process.env.R2_PUBLIC_URL}/${objectKey}`;
  log.info("upload.ok", { key: objectKey });
  return { url, objectKey };
};
