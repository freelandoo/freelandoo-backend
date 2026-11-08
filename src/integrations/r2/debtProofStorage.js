// src/integrations/r2/debtProofStorage.js
//
// Comprovante de pagamento do feed de boletos (A2, mig 338). Mesmo molde do
// comprovante de residência (residenceProofStorage.js):
//
//   - SEM URL pública: o comprovante tem nome e banco de quem pagou. Quem
//     confere (o dono do boleto e a moderação) recebe URL assinada de 5 min.
//   - SEM presigned PUT: sobe pelo servidor (o bucket não tem CORS).
//   - APAGADO assim que o dono confirma ou recusa: o veredito fica, o arquivo
//     não.

const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.debtProof");

const PREFIX = "debt-proofs";
const VIEW_EXPIRES = 300;

const EXT_BY_MIME = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extForMime(mimetype) {
  return EXT_BY_MIME[String(mimetype || "").toLowerCase()] || null;
}

function buildKey(id_bill, ext) {
  return `${PREFIX}/${id_bill}/${crypto.randomUUID()}.${ext}`;
}

async function putObject(key, buffer, contentType) {
  await r2.send(
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType })
  );
}

async function presignView(key, expiresIn = VIEW_EXPIRES) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }), { expiresIn });
}

async function deleteObject(key) {
  if (!key) return false;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err) {
    log.warn("delete.fail", { message: err.message });
    return false;
  }
}

module.exports = { PREFIX, extForMime, buildKey, putObject, presignView, deleteObject };
