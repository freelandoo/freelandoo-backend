const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadProtectionMedia");

function getFileExt(originalname = "") {
  const parts = String(originalname).split(".");
  return (parts.length > 1 ? parts.pop() : "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
}

/**
 * Sobe uma foto de prova/evidência da Proteção de Pagamento ao R2.
 * @param {Object} args
 * @param {string} args.prefix  — 'fulfillment-proof' | 'dispute-evidence'
 * @param {string|number} args.id — id agrupador (protection_case_id / dispute_id)
 * @param {Object} args.file — arquivo do multer (memoryStorage): { buffer, mimetype, originalname }
 * @returns {Promise<{ url: string, key: string }>}
 */
module.exports = async function uploadProtectionMediaToR2({ prefix, id, file }) {
  if (!file?.buffer?.length) throw new Error("Arquivo ausente");
  const ext = getFileExt(file.originalname);
  const key = `${prefix}/${id}/${crypto.randomUUID()}.${ext}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || "image/jpeg",
    })
  );
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  log.info("upload.ok", { key });
  return { url, key };
};
