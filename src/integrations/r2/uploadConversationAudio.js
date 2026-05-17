const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.conversationAudio");

/**
 * Sobe o buffer de áudio comprimido em `chat-audio/private/{id_conversation}/{id_message}.{ext}`.
 * Retorna { url, key }.
 */
async function uploadConversationAudio({
  id_conversation,
  id_message,
  buffer,
  mimetype,
  extension,
}) {
  if (!id_conversation || !id_message) {
    throw new Error("id_conversation e id_message são obrigatórios");
  }
  if (!buffer?.length) throw new Error("buffer vazio");

  const ext = String(extension || "webm").replace(/^\.+/, "");
  const key = `chat-audio/private/${id_conversation}/${id_message}.${ext}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimetype || "audio/webm",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  log.info("upload.ok", { key, size: buffer.length });
  return { url, key };
}

/**
 * Best-effort delete no R2. Loga warn mas não throw.
 */
async function deleteConversationAudio(key) {
  if (!key) return false;
  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      })
    );
    log.info("delete.ok", { key });
    return true;
  } catch (err) {
    log.warn("delete.fail", { key, err: err?.message });
    return false;
  }
}

module.exports = { uploadConversationAudio, deleteConversationAudio };
