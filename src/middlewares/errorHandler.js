// src/middlewares/errorHandler.js
//
// O último middleware do app: transforma o erro que escapou de uma rota em
// resposta JSON.
//
// Segurança A6 (A6-03): antes, TODO erro devolvia `err.message` ao cliente —
// inclusive o texto cru do Postgres (`invalid input syntax for type uuid`,
// nome de restrição, de tabela, de coluna) e erro de programação
// (`Cannot read properties of undefined…`). Isso entrega o desenho do banco a
// quem está mapeando a API. Agora:
//   - erro do banco com valor mal formado (uuid, data, número) → 400
//     "Parâmetro inválido." (o id torto deixava a rota em 500);
//   - qualquer outro erro do banco, de programação ou de sistema → mensagem
//     genérica; o detalhe continua no log e no Painel de Arquitetura;
//   - `throw new Error("texto para o usuário")` de service segue igual: é a
//     mensagem que as telas mostram hoje.

const { createLogger } = require("../utils/logger");
const { redactUrl } = require("../utils/redactUrl");

const log = createLogger("app");

const GENERIC = "Erro interno no servidor.";

// SQLSTATE de valor mal formado vindo do cliente (classe 22).
const PG_BAD_INPUT = new Set(["22P02", "22007", "22008", "22003", "22001", "22023"]);

const INTERNAL_NAMES = new Set([
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
]);

function isPgError(err) {
  return Boolean(
    err &&
      typeof err.code === "string" &&
      /^[0-9A-Z]{5}$/.test(err.code) &&
      (err.severity || err.routine || err.name === "DatabaseError")
  );
}

function isSystemError(err) {
  return Boolean(err && (err.syscall || typeof err.errno === "number"));
}

function isInternal(err) {
  return isPgError(err) || isSystemError(err) || INTERNAL_NAMES.has(err?.name);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const isUploadError =
    err.name === "MulterError" ||
    ["Formato nao aceito", "Tipo de arquivo nao permitido"].some((msg) =>
      String(err.message || "").includes(msg)
    );
  const isPayloadTooLarge = err.type === "entity.too.large" || err.status === 413;
  const pgBadInput = isPgError(err) && PG_BAD_INPUT.has(err.code);

  let statusCode =
    err.statusCode ||
    (isPayloadTooLarge ? 413 : isUploadError ? 400 : pgBadInput ? 400 : 500);

  let message =
    err.code === "LIMIT_FILE_SIZE"
      ? "Arquivo muito grande para upload."
      : isPayloadTooLarge
        ? "Payload acima do limite permitido."
        : err.message || GENERIC;

  if (pgBadInput && !err.statusCode) {
    message = "Parâmetro inválido.";
  } else if (statusCode >= 500 && isInternal(err)) {
    message = GENERIC;
  }
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) statusCode = 500;

  if (statusCode >= 500 || pgBadInput) {
    log.error("error_handler", {
      requestId: req.requestId,
      statusCode,
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
      method: req.method,
      url: redactUrl(req.originalUrl || req.url),
    });
  }

  // Detalhe do erro para o routeLog persistir em arch_route_logs (Painel de Arquitetura).
  res.locals.archError = { message: err?.message, stack: err?.stack };

  return res.status(statusCode).json({ error: message });
}

/** Rota que não existe: JSON (o padrão do Express é uma página HTML). */
function notFound(req, res) {
  res.status(404).json({ error: "Rota não encontrada." });
}

module.exports = { errorHandler, notFound, isPgError, GENERIC };
