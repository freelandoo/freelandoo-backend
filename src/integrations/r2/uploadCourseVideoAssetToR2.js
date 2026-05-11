const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadCourseVideoAsset");

const KIND_CONFIG = {
  processed: { ext: "mp4", contentType: "video/mp4" },
  thumb: { ext: "jpg", contentType: "image/jpeg" },
};

/**
 * Sobe assets derivados do vídeo da aula no mesmo prefix do original:
 * course-videos/{userId}/{courseId}/{lessonId}/{kind}-{uuid}.{ext}
 *
 * Kinds suportados: "processed" (mp4), "thumb" (jpg).
 */
module.exports = async function uploadCourseVideoAssetToR2({
  kind,
  buffer,
  userId,
  courseId,
  lessonId,
}) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error(`Kind de asset inválido: ${kind}`);

  const key = `course-videos/${userId}/${courseId}/${lessonId}/${kind}-${crypto.randomUUID()}.${cfg.ext}`;
  log.info("upload.start", { kind, key, bytes: buffer?.length });

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: cfg.contentType,
    }),
  );

  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  log.info("upload.ok", { kind, key });
  return { url, key };
};
