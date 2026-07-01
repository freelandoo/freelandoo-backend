const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");

function getFileExt(originalname = "") {
  const parts = String(originalname).split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

// Sobe a capa (banner) da vaquinha para o prefixo vaquinha-covers/<id_vaquinha>/.
// A imagem é enviada como está (superfície interna de alto volume → <img> lazy no
// front, sem otimização Vercel). Retorna a URL pública.
module.exports = async function uploadVaquinhaCoverToR2({ id_vaquinha, file }) {
  const key = `vaquinha-covers/${id_vaquinha}/${crypto.randomUUID()}.${getFileExt(file.originalname)}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return { url: `${process.env.R2_PUBLIC_URL}/${key}` };
};
