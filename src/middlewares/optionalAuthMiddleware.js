const jwt = require("jsonwebtoken");

// Anexa req.user se houver token válido. Não bloqueia requests anônimos.
function optionalAuthMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  const [, token] = authHeader.split(" ");
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id_user: decoded.id_user, email: decoded.email };
  } catch {
    // ignora token inválido — segue como anônimo
  }
  return next();
}

module.exports = optionalAuthMiddleware;
