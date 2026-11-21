// src/utils/malvoSignature.js
//
// Conferência do webhook da Malvo (mig 462).
//
//   Malvo-Signature: t=<unix>,v1=<hex>[,v1=<hex>]
//   v1 = HMAC-SHA256( secret, "{t}." + corpo_cru ), hex minúsculo
//
// ⚠️ O CORPO TEM QUE SER OS BYTES CRUS do POST (rota com `express.raw`).
// `JSON.parse` + `JSON.stringify` muda espaços e a ordem e a assinatura nunca
// confere — e a "correção" tentadora seria desligar a checagem, o que deixaria
// uma rota pública aceitando qualquer corpo da internet.
//
// ⚠️ A string inteira do segredo entra na chave, INCLUINDO o prefixo `whsec_`
// (é o que a doc da Malvo pede e o vetor de teste confirma).
//
// Durante uma rotação o header pode trazer dois `v1`: vale qualquer um. Aceita
// também uma lista de segredos (atual + anterior) para a troca sem janela cega.
const crypto = require("crypto");

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function parseHeader(header) {
  const out = { t: null, v1: [] };
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") out.t = v;
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) out.v1.push(v.toLowerCase());
  }
  return out;
}

function sign(secret, t, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  return crypto
    .createHmac("sha256", String(secret))
    .update(Buffer.concat([Buffer.from(`${t}.`, "utf8"), body]))
    .digest("hex");
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * @param {Buffer|string} rawBody corpo cru do POST
 * @param {string} header valor de `Malvo-Signature`
 * @param {string|string[]} secrets segredo atual (e, na rotação, o anterior)
 * @param {{ now?: number, toleranceSeconds?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyMalvoSignature(rawBody, header, secrets, opts = {}) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter((s) => typeof s === "string" && s);
  if (!list.length) return { ok: false, reason: "sem_segredo" };

  const parsed = parseHeader(header);
  if (!parsed.t || !/^\d+$/.test(parsed.t)) return { ok: false, reason: "sem_timestamp" };
  if (!parsed.v1.length) return { ok: false, reason: "sem_assinatura" };

  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    if (Math.abs(now - Number(parsed.t)) > tolerance) return { ok: false, reason: "fora_da_janela" };
  }

  for (const secret of list) {
    const expected = sign(secret, parsed.t, rawBody);
    if (parsed.v1.some((v) => safeEqualHex(v, expected))) return { ok: true };
  }
  return { ok: false, reason: "assinatura_invalida" };
}

module.exports = { verifyMalvoSignature, parseHeader, sign };
