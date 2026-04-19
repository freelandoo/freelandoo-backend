const jwt = require("jsonwebtoken");
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

  try {
    // 🔐 valida token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🧠 anexa o usuário na request
    req.user = {
      id_user: decoded.id_user,
      email: decoded.email,
    };

    return next();
  } catch (err) {
    log.warn("invalid_token", {
      path: req.originalUrl || req.url,
      message: err?.message,
    });
    return res.status(401).json({
      error: "Token inválido ou expirado",
    });
  }
}

module.exports = authMiddleware;
