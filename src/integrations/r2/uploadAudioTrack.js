// Upload de faixa de áudio (e capa) pro R2 sob o prefixo audio-library/.
// Bytes vêm em memória (multer memoryStorage) e o backend faz o PutObject.
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadAudioTrack");

const AUDIO_PREFIX = "audio-library";

function getExt(originalname = "", fallback = "bin") {
  const parts = String(originalname).split(".");
  return (parts.length > 1 ? parts.pop() : fallback).toLowerCase();
}

async function putBuffer(key, buffer, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/** Sobe a faixa de áudio. Retorna { storage_key, url }. */
async function uploadAudioFile(file) {
  const ext = getExt(file.originalname, "mp3");
  const key = `${AUDIO_PREFIX}/track-${crypto.randomUUID()}.${ext}`;
  log.info("upload.audio.start", { mimetype: file?.mimetype });
  const url = await putBuffer(key, file.buffer, file.mimetype || "audio/mpeg");
  log.info("upload.audio.ok", { key });
  return { storage_key: key, url };
}

/** Sobe a capa (imagem). Retorna { cover_key, url }. */
async function uploadAudioCover(file) {
  const ext = getExt(file.originalname, "webp");
  const key = `${AUDIO_PREFIX}/cover-${crypto.randomUUID()}.${ext}`;
  log.info("upload.cover.start", { mimetype: file?.mimetype });
  const url = await putBuffer(key, file.buffer, file.mimetype || "image/webp");
  log.info("upload.cover.ok", { key });
  return { cover_key: key, url };
}

function publicUrl(key) {
  if (!key) return null;
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = { AUDIO_PREFIX, uploadAudioFile, uploadAudioCover, publicUrl };
