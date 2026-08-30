// src/integrations/r2/residenceProofStorage.js
//
// O comprovante de residência filmado (mig 206). Duas diferenças deliberadas em
// relação aos outros uploads do projeto:
//
//   1. NÃO existe URL pública. `publicUrl` não é exportado aqui de propósito —
//      o arquivo é um documento de terceiro, e um link permanente para ele
//      seria um vazamento com prazo indeterminado. Quem assiste recebe uma URL
//      ASSINADA de vida curta, emitida por chamada, para quem tem papel.
//
//   2. NÃO existe presigned PUT. O vídeo sobe pelo servidor (multipart), e não
//      direto do browser — o bucket não tem regra de CORS em produção
//      (o PUT direto falha, ver memória `project_freelandoo_r2_cors`), e mais:
//      um PUT assinado para o browser exigiria devolver a key ao cliente antes
//      de o arquivo existir, o que abre espaço para registrar comprovante que
//      nunca foi enviado.
//
// A key vive sob `residence-proofs/<id_condo>/`, e o expurgo (purge_after) apaga
// o objeto — o veredito persiste, o documento não.

const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.residenceProof");

const PREFIX = "residence-proofs";

// Janela de leitura curta: o síndico assiste agora, não guarda o link.
const VIEW_EXPIRES = 300;

const EXT_BY_MIME = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function extForMime(mimetype) {
  return EXT_BY_MIME[String(mimetype || "").toLowerCase()] || null;
}

function buildKey(id_condo, ext) {
  return `${PREFIX}/${id_condo}/${crypto.randomUUID()}.${ext}`;
}

// A key volta do cliente em alguns fluxos; só aceitamos o namespace deste
// condomínio, pelo mesmo motivo que a story valida o namespace do perfil.
function keyBelongsToCondo(key, id_condo) {
  if (typeof key !== "string" || !key) return false;
  if (key.includes("..") || key.includes("//")) return false;
  return key.startsWith(`${PREFIX}/${id_condo}/`);
}

async function putObject(key, buffer, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

/** URL assinada de leitura. Emitida por chamada, nunca guardada em banco. */
async function presignView(key, expiresIn = VIEW_EXPIRES) {
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(r2, cmd, { expiresIn });
}

async function deleteObject(key) {
  try {
    await r2.send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
    );
    return true;
  } catch (err) {
    // O expurgo é best-effort: objeto já removido não é erro, e falhar aqui não
    // pode impedir a linha de ser marcada como expurgada — senão o sweeper
    // reprocessa a mesma linha para sempre.
    log.warn("delete.fail", { message: err.message });
    return false;
  }
}

module.exports = {
  PREFIX,
  extForMime,
  buildKey,
  keyBelongsToCondo,
  putObject,
  presignView,
  deleteObject,
};
