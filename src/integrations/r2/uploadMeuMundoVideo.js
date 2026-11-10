const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");

const EXT = { "video/mp4": "mp4", "video/webm": "webm", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

// Lore v2 F5: vídeo (ou imagem de capa) de um capítulo / personagem do Meu Mundo,
// no prefixo meu-mundo/videos/<kind>/<ref>/. Arquivo vai como veio (o Alex gera
// pronto); nome novo a cada envio, então o cache do navegador nunca serve o antigo.
module.exports = async function uploadMeuMundoVideoToR2({ kind, ref, file }) {
  const ext = EXT[String(file.mimetype || "").toLowerCase()] || "bin";
  const key = `meu-mundo/videos/${kind}/${ref}/${crypto.randomUUID()}.${ext}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return { url: `${process.env.R2_PUBLIC_URL}/${key}` };
};
