const { createLogger } = require("./logger");

const httpLog = createLogger("http");

/**
 * Envolve handlers async do Express e encaminha rejeições para next(err).
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    const label = fn.name || "handler";
    httpLog.debug("handler.enter", {
      label,
      method: req.method,
      url: req.originalUrl || req.url,
      user: req.user?.id_user,
    });
    return Promise.resolve(fn(req, res, next)).catch((err) => {
      httpLog.error("handler.reject", {
        label,
        method: req.method,
        url: req.originalUrl || req.url,
        user: req.user?.id_user,
        message: err?.message,
        stack: err?.stack,
      });
      next(err);
    });
  };
}

module.exports = asyncHandler;
