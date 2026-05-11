const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadCourseVideo");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

/**
 * Sobe o arquivo original do vídeo da aula no R2.
 * Prefixo: course-videos/{userId}/{courseId}/{lessonId}/original-{uuid}.{ext}
 * Retorna { url, key } — Slice 8 (ffmpeg) usará a chave para o output processed.
 */
module.exports = async function uploadCourseVideoToR2({
  file,
  userId,
  courseId,
  lessonId,
}) {
  log.info("upload.start", {
    user_id: userId,
    course_id: courseId,
    lesson_id: lessonId,
    mimetype: file?.mimetype,
    size: file?.size,
  });

  const fileExt = getFileExt(file.originalname);
  const key = `course-videos/${userId}/${courseId}/${lessonId}/original-${crypto.randomUUID()}.${fileExt}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  log.info("upload.ok", { key });
  return { url, key };
};
