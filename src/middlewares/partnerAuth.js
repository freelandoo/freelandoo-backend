// src/middlewares/partnerAuth.js
// Autentica /partner/v1/* pela chave de parceiro da academia (mig 296):
// `Authorization: Bearer flnd_parc_...`. A chave identifica UMA academia —
// injeta req.partnerAcademy e tudo abaixo fica escopado a ela.
//
// O banco só tem o SHA-256 (índice único). A busca é pelo hash e a conferência
// final é em tempo constante. Chave ausente, malformada, revogada (rotacionada)
// ou de academia inativa → 401 { erro: "chave_invalida" }.
//
// A flag global `fitness_academias` NÃO é exigida aqui de propósito: a chave
// só existe porque o DONO da academia a gerou — é o opt-in explícito daquela
// academia, e a integração precisa funcionar mesmo com o painel fitness ainda
// desligado para o resto do site.
const pool = require("../databases");
const PartnerStorage = require("../storages/PartnerStorage");
const { sha256Hex, isPartnerKeyFormat, hashesEqual } = require("../utils/partnerKey");
const { createLogger } = require("../utils/logger");

const log = createLogger("partnerAuth");

function unauthorized(res) {
  return res.status(401).json({ erro: "chave_invalida" });
}

async function partnerAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const key = match ? match[1] : null;
  if (!key || !isPartnerKeyFormat(key)) return unauthorized(res);
  try {
    const hash = sha256Hex(key);
    const academy = await PartnerStorage.getAcademyByPartnerKeyHash(pool, hash);
    if (!academy || !hashesEqual(hash, academy.partner_key_hash) || !academy.is_active) {
      log.warn("invalid_key", { ip: req.ip });
      return unauthorized(res);
    }
    req.partnerAcademy = academy;
    return next();
  } catch (err) {
    log.error("auth_error", { message: err?.message });
    return res.status(500).json({ erro: "erro_interno" });
  }
}

module.exports = partnerAuth;
