// src/utils/partnerKey.js
// Chave de parceiro da academia (mig 296) e token de primeiro acesso.
//
// Os dois segredos seguem a mesma regra das chaves de API do projeto
// (flnd_atd_ / flnd_data_): o valor cru só existe na resposta que o cria; o
// banco guarda o SHA-256. A busca é pelo hash (índice único) e a conferência
// final é em tempo constante.
const crypto = require("crypto");

const PARTNER_KEY_PREFIX = "flnd_parc_";
const FIRST_ACCESS_TTL_DAYS = 7;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generatePartnerKey() {
  return `${PARTNER_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

function isPartnerKeyFormat(raw) {
  return typeof raw === "string" && raw.startsWith(PARTNER_KEY_PREFIX) && raw.length >= PARTNER_KEY_PREFIX.length + 32;
}

/** Comparação em tempo constante de dois hashes hex (mesmo tamanho). */
function hashesEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function generateFirstAccessToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  PARTNER_KEY_PREFIX,
  FIRST_ACCESS_TTL_DAYS,
  sha256Hex,
  generatePartnerKey,
  isPartnerKeyFormat,
  hashesEqual,
  generateFirstAccessToken,
};
