// src/utils/sessionToken.js — o ÚNICO lugar que emite e confere token (A3).
//
// Token de SESSÃO (login): HS256 com `JWT_SECRET`, `{ id_user, email }`, com
// validade (`JWT_EXPIRES_IN`, padrão 1 dia). É o mesmo formato que o login
// sempre emitiu — os tokens que estão nos aparelhos hoje continuam valendo.
// A conferência é que ficou estrita:
//   - algoritmo fixo em HS256 (outro HS* com o mesmo segredo é recusado);
//   - `exp` obrigatório (token eterno não existe);
//   - token com `purpose` NÃO é sessão. Antes, o estado do "conectar Steam"
//     (`purpose: "game_connect"`, com `id_user`, assinado com o mesmo segredo)
//     viajava na URL de volta da Steam e abria a conta inteira por 10 minutos.
//
// Token de PROPÓSITO (estado de OAuth, links curtos): assinado com uma chave
// DERIVADA do segredo por propósito (HMAC), então nunca abre como sessão e um
// propósito não serve a outro.
//
// O authMiddleware continua sem I/O: tudo aqui é CPU.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ALGORITHM = "HS256";

function rootSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET ausente");
  return s;
}

function signSession({ id_user, email }) {
  return jwt.sign({ id_user, email }, rootSecret(), {
    algorithm: ALGORITHM,
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
}

/**
 * Confere um token de sessão. Devolve `{ ok: true, claims }` ou
 * `{ ok: false, reason }` (o motivo vai só para o log).
 */
function verifySession(token) {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  let claims;
  try {
    claims = jwt.verify(token, rootSecret(), { algorithms: [ALGORITHM] });
  } catch (err) {
    return { ok: false, reason: err?.message || "invalid" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, reason: "payload" };
  if (claims.purpose !== undefined) return { ok: false, reason: "not_a_session" };
  if (!claims.id_user) return { ok: false, reason: "no_subject" };
  if (!Number.isFinite(claims.exp)) return { ok: false, reason: "no_expiry" };
  return { ok: true, claims };
}

function purposeKey(purpose) {
  return crypto
    .createHmac("sha256", rootSecret())
    .update(`freelandoo:purpose:${purpose}`)
    .digest();
}

function signPurposeToken(purpose, claims, expiresIn) {
  return jwt.sign({ ...claims, purpose }, purposeKey(purpose), {
    algorithm: ALGORITHM,
    expiresIn,
  });
}

/** Devolve as claims ou `null` (expirado, adulterado ou de outro propósito). */
function verifyPurposeToken(purpose, token) {
  try {
    const claims = jwt.verify(String(token || ""), purposeKey(purpose), {
      algorithms: [ALGORITHM],
    });
    return claims && claims.purpose === purpose ? claims : null;
  } catch {
    return null;
  }
}

module.exports = { signSession, verifySession, signPurposeToken, verifyPurposeToken, ALGORITHM };
