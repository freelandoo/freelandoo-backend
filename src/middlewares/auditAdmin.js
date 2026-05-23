// Log estruturado de toda requisição que entra em rota /admin/*.
//
// Não cria tabela ainda (decisão D3 do hardening) — vai pro logger
// estruturado existente. Se um dia quiser auditoria pesquisável, criar
// migration com tabela `audit_log` e fazer este middleware INSERTar.
//
// Registra ao finalizar a resposta para incluir status code real.

const { createLogger } = require("../utils/logger");

const log = createLogger("audit-admin");

module.exports = function auditAdmin(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    log.info("admin.action", {
      requestId: req.requestId,
      id_user: req.user?.id_user || null,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
      ua: req.headers["user-agent"] || null,
    });
  });
  next();
};
