// src/integrations/r2/presignCompressUpload.js
//
// Ferramenta /comprimir (vídeo): o cliente sobe o vídeo grande DIRETO pro R2 via
// presigned PUT (bytes não passam pelo backend → não estoura a memória do
// Railway). O backend depois baixa do R2 pro disco, roda ffmpeg e sobe a saída.
// Tudo vive sob o prefixo `temp-compress/` (lifecycle do R2 expira em ~3h).
const {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");
const fs = require("fs/promises");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.presignCompressUpload");

const DEFAULT_EXPIRES = 600; // 10 min — vídeo grande pode demorar pra subir
const PREFIX = "temp-compress";

const VIDEO_EXT = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

function extForType(contentType) {
  return VIDEO_EXT[String(contentType || "").toLowerCase()] || null;
}

// Cada job ganha sua própria pasta sob temp-compress/<id_user>/<uuid>/ — o
// id_user no caminho garante que um usuário só confirme as próprias keys.
function buildJob(id_user) {
  const jobId = crypto.randomUUID();
  return { jobId, base: `${PREFIX}/${id_user}/${jobId}` };
}

function inputKey(base, ext) {
  return `${base}/input.${ext}`;
}
function outputKey(base) {
  return `${base}/output.mp4`;
}

function keyBelongsToUser(key, id_user) {
  if (typeof key !== "string" || !key) return false;
  if (key.includes("..") || key.includes("//")) return false;
  return key.startsWith(`${PREFIX}/${id_user}/`);
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
    return { exists: true, size: Number(out.ContentLength) || 0, contentType: out.ContentType || null };
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
      return { exists: false, size: 0, contentType: null };
    }
    throw err;
  }
}

// Baixa o objeto do R2 streamando pro disco (não carrega o vídeo na memória).
async function downloadToFile(key, destPath) {
  const out = await r2.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
  );
  await pipeline(out.Body, createWriteStream(destPath));
}

// Sobe a saída (já pequena) com Content-Disposition pra forçar download.
async function uploadFile(key, filePath, contentType, downloadName) {
  const body = await fs.readFile(filePath);
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentDisposition: downloadName
        ? `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`
        : undefined,
    })
  );
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

// Varredura de retenção: apaga objetos de temp-compress/ mais velhos que
// `maxAgeMs` (default 3h). Rede de segurança caso o lifecycle do bucket R2 não
// esteja configurado ou só tenha granularidade diária (mínimo de alguns
// provedores). Idempotente; falha de uma página não derruba o resto.
async function sweepExpired(maxAgeMs = 3 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let token;
  let deleted = 0;
  do {
    const out = await r2.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: `${PREFIX}/`,
        ContinuationToken: token,
        MaxKeys: 1000,
      })
    );
    const stale = (out.Contents || []).filter(
      (o) => o.LastModified && new Date(o.LastModified).getTime() < cutoff
    );
    for (const obj of stale) {
      await deleteObject(obj.Key);
      deleted += 1;
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return { deleted };
}

module.exports = {
  DEFAULT_EXPIRES,
  PREFIX,
  extForType,
  buildJob,
  inputKey,
  outputKey,
  keyBelongsToUser,
  presignPut,
  headObject,
  downloadToFile,
  uploadFile,
  deleteObject,
  publicUrl,
  sweepExpired,
};
