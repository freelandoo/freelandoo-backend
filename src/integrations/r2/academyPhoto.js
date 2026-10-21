// src/integrations/r2/academyPhoto.js
// Foto do cadastro do aluno NA ACADEMIA (mig 296), enviada pela API de
// parceiro. Fica no prefixo `academy-photos/{id_academy}/` e é SEPARADA do
// avatar: antes do aceite ela é dado privado, então nunca é servida pela URL
// pública — a leitura é GetObject autenticado (`getAcademyPhoto`). Só quando o
// aluno aceita "usar a foto da academia" ela é COPIADA para `avatars/` e vira
// foto de perfil (pública, como qualquer avatar).
const { PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.academyPhoto");

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function extFor(mimetype) {
  return EXT_BY_MIME[String(mimetype || "").toLowerCase()] || "jpg";
}

async function putAcademyPhoto({ id_academy, id_user, buffer, mimetype }) {
  const key = `academy-photos/${id_academy}/${id_user}-${crypto.randomUUID()}.${extFor(mimetype)}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  );
  log.info("put.ok", { key });
  return key;
}

/** Stream autenticado (Body + ContentType) — para o modal de aceite mostrar a foto. */
async function getAcademyPhoto(key) {
  const out = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  return { body: out.Body, contentType: out.ContentType || "image/jpeg" };
}

/** Copia a foto da academia para `avatars/` e devolve a URL pública do avatar. */
async function copyAcademyPhotoToAvatar({ key, id_user, mimetype }) {
  const avatarKey = `avatars/${id_user}-${crypto.randomUUID()}.${extFor(mimetype)}`;
  const bucket = process.env.R2_BUCKET_NAME;
  await r2.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: avatarKey,
      CopySource: `${bucket}/${key}`,
      ContentType: mimetype,
      MetadataDirective: "REPLACE",
    })
  );
  log.info("copy_to_avatar.ok", { avatarKey });
  return `${process.env.R2_PUBLIC_URL}/${avatarKey}`;
}

async function deleteAcademyPhoto(key) {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  } catch (err) {
    log.warn("delete.fail", { key, message: err?.message });
  }
}

module.exports = { putAcademyPhoto, getAcademyPhoto, copyAcademyPhotoToAvatar, deleteAcademyPhoto };
