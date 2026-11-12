const { verifySession } = require("../utils/sessionToken");
const { createLogger } = require("../utils/logger");

const log = createLogger("authMiddleware");

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // 🔎 verifica se existe token
  if (!authHeader) {
    log.warn("missing_token", { path: req.originalUrl || req.url });
    return res.status(401).json({
      error: "Token não informado",
    });
  }

  const [, token] = authHeader.split(" ");

  // 🔐 só token de SESSÃO (HS256, com validade, sem `purpose`) — ver sessionToken.js
  const v = verifySession(token);
  if (!v.ok) {
    log.warn("invalid_token", {
      path: req.originalUrl || req.url,
      message: v.reason,
    });
    return res.status(401).json({
      error: "Token inválido ou expirado",
    });
  }

  // 🧠 anexa o usuário na request
  req.user = {
    id_user: v.claims.id_user,
    email: v.claims.email,
  };

  return next();
}

module.exports = authMiddleware;
