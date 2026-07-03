// src/middlewares/apiConnectionAuth.js
// Autentica requests do /ext/v1[/data] pelo token pessoal (Bearer flnd_atd_ ou
// flnd_data_). Injeta req.apiConnection (com .kind) e req.user (o DONO) — os
// services internos reusados enxergam o dono normalmente. O guard de kind
// (requireConnectionKind) é montado por rota para separar atendimento × dados.
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ApiConnectionService = require("../services/ApiConnectionService");
const { createLogger } = require("../utils/logger");

const log = createLogger("apiConnectionAuth");

async function apiConnectionAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  if (!token || !ApiConnectionService.isKnownTokenPrefix(token)) {
    return res.status(401).json({ error: "Token de API não informado ou inválido" });
  }
  try {
    const connection = await ApiConnectionStorage.getActiveByTokenHash(
      pool,
      ApiConnectionService.sha256Hex(token)
    );
    if (!connection) {
      return res.status(401).json({ error: "Token de API inválido ou revogado" });
    }
    req.apiConnection = connection;
    req.user = { id_user: connection.id_user };
    // Auditoria best-effort (throttle de 60s embutido no SQL).
    ApiConnectionStorage.touchLastUsed(pool, {
      id_connection: connection.id_connection,
      ip: req.ip,
    }).catch(() => {});
    return next();
  } catch (err) {
    log.error("auth_error", { message: err?.message });
    return res.status(500).json({ error: "Erro ao autenticar" });
  }
}

module.exports = apiConnectionAuth;
