// Anexa um requestId único a cada request — usado para correlacionar
// logs do mesmo handler, especialmente sob carga concorrente.
// Respeita header `X-Request-Id` do upstream (Vercel/Railway/CDN) se vier.

const { randomUUID } = require("crypto");

module.exports = function requestId(req, res, next) {
  const incoming =
    req.headers["x-request-id"] || req.headers["x-correlation-id"];
  const id =
    typeof incoming === "string" && incoming.length > 0 && incoming.length < 128
      ? incoming
      : randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};
