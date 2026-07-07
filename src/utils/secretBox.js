// src/utils/secretBox.js
// Cifra simétrica p/ segredos que PRECISAM ser recuperáveis (ex.: token da
// Gym Provider API de cada academia, usado em chamadas outbound). AES-256-GCM,
// chave derivada de SECRET_BOX_KEY (preferida) ou JWT_SECRET via sha256.
// Formato: v1:<iv b64>:<tag b64>:<ciphertext b64>
const crypto = require("crypto");

function key() {
  const src = process.env.SECRET_BOX_KEY || process.env.JWT_SECRET;
  if (!src) throw new Error("SECRET_BOX_KEY/JWT_SECRET ausentes — secretBox indisponível");
  return crypto.createHash("sha256").update(String(src)).digest();
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function open(sealed) {
  const [v, ivB64, tagB64, ctB64] = String(sealed || "").split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("secretBox: formato inválido");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

module.exports = { seal, open };
