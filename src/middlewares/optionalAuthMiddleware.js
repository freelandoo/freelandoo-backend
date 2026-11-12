const { verifySession } = require("../utils/sessionToken");

// Anexa req.user se houver token de sessão válido. Não bloqueia requests
// anônimos: token inválido (ou de outro propósito) segue como anônimo.
function optionalAuthMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  const [, token] = authHeader.split(" ");
  if (!token) return next();

  const v = verifySession(token);
  if (v.ok) req.user = { id_user: v.claims.id_user, email: v.claims.email };
  return next();
}

module.exports = optionalAuthMiddleware;
