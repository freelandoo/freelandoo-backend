// src/integrations/r2/accountingReceiptStorage.js
//
// Comprovantes de pagamento das guias do painel de Contabilidade (mig 277).
// Mesmo modelo do comprovante de residência (residenceProofStorage): é
// documento fiscal da empresa, então NÃO existe URL pública — quem abre recebe
// uma URL ASSINADA de vida curta, emitida por chamada, só para admin.

const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.accountingReceipt");

const PREFIX = "accounting-receipts";
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

function buildKey(id_company, ext) {
  return `${PREFIX}/${id_company}/${crypto.randomUUID()}.${ext}`;
}

async function putObject(key, buffer, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

async function presignView(key) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
    { expiresIn: VIEW_EXPIRES },
  );
}

async function deleteObject(key) {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err) {
    // Best-effort: o objeto órfão custa centavos; falhar aqui não pode impedir
    // a troca do comprovante nem a exclusão da guia.
    log.warn("delete.fail", { message: err.message });
    return false;
  }
}

module.exports = { PREFIX, extForMime, buildKey, putObject, presignView, deleteObject };
