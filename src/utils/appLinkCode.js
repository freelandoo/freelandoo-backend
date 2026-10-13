// src/utils/appLinkCode.js
//
// O CÓDIGO DE VÍNCULO DO APP (mig 278) — regra única de formato e de hash.
//
// O código é DIGITADO à mão num celular (o 1º APK não tem deep link), então:
//   - alfabeto sem ambíguos: sem 0/O, 1/I/L — quem lê "0" e digita "O" não pode
//     levar "código inválido";
//   - 8 caracteres (31^8 ≈ 8,5×10¹¹), mostrados como ABCD-EFGH;
//   - normalizar ignora espaço, hífen e caixa, e devolve os ambíguos ao lugar
//     (O→0 não existe no alfabeto, então O vira... nada: é recusado).
//
// ⚠️ O banco guarda só o SHA-256 do código normalizado. Hash sem sal é
// aceitável AQUI porque o código vive 5 minutos, é de uso único e a porta de
// troca tem rate limit — não é senha de longo prazo.

const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 5 * 60;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH * 2);
  let out = "";
  // Rejeição de viés: 256 % 31 ≠ 0, então descarta os bytes do "resto".
  const limit = 256 - (256 % ALPHABET.length);
  for (let i = 0; i < bytes.length && out.length < CODE_LENGTH; i += 1) {
    if (bytes[i] < limit) out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  if (out.length < CODE_LENGTH) return generateCode();
  return out;
}

/** "abcd efgh", "ABCD-EFGH" → "ABCDEFGH"; null se não for um código possível. */
function normalizeCode(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

function formatCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Refresh token opaco do app: prefixo legível + 32 bytes aleatórios. */
function generateSessionToken() {
  return `evo_rt_${crypto.randomBytes(32).toString("base64url")}`;
}

function isSessionTokenShape(raw) {
  return typeof raw === "string" && /^evo_rt_[A-Za-z0-9_-]{40,60}$/.test(raw);
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  CODE_TTL_SECONDS,
  generateCode,
  normalizeCode,
  formatCode,
  sha256,
  generateSessionToken,
  isSessionTokenShape,
};
