// src/integrations/r2/presignStoryUpload.js
//
// Módulo de câmera (zero-servidor / GPU-local): o cliente grava o vídeo MP4/H.264
// no browser (WebCodecs) e faz upload DIRETO pro R2 via presigned PUT. O backend
// não transcoda — só assina a URL (escopo: content-type + key namespaced + expiração
// curta) e, depois, verifica o objeto (HeadObject) antes de gravar a story.
const {
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.presignStoryUpload");

const DEFAULT_EXPIRES = 300; // 5 min — janela curta de upload

const STORY_PREFIX = "stories";

function buildKey(id_profile, kind, ext, suffix = "") {
  const safeKind = kind === "trampo" ? "trampo" : "rest";
  const tag = suffix ? `-${suffix}` : "";
  return `${STORY_PREFIX}/${id_profile}/${safeKind}-${crypto.randomUUID()}${tag}.${ext}`;
}

// Garante que a key pertence ao namespace do perfil (segurança: o cliente devolve
// a key no passo from-upload; só aceitamos keys sob stories/<id_profile>/).
function keyBelongsToProfile(key, id_profile) {
  if (typeof key !== "string" || !key) return false;
  if (key.includes("..") || key.includes("//")) return false;
  return key.startsWith(`${STORY_PREFIX}/${id_profile}/`);
}

async function presignPut(key, contentType, expiresIn = DEFAULT_EXPIRES) {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, cmd, { expiresIn });
}

async function headObject(key) {
  try {
    const out = await r2.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
    );
    return {
      exists: true,
      size: Number(out.ContentLength) || 0,
      contentType: out.ContentType || null,
    };
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
      return { exists: false, size: 0, contentType: null };
    }
    throw err;
  }
}

async function deleteObject(key) {
  try {
    await r2.send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
    );
  } catch (err) {
    log.warn("delete_failed", { key, err: err?.message });
  }
}

function publicUrl(key) {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = {
  DEFAULT_EXPIRES,
  STORY_PREFIX,
  buildKey,
  keyBelongsToProfile,
  presignPut,
  headObject,
  deleteObject,
  publicUrl,
};
