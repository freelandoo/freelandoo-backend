const { createLogger } = require("./logger");

const log = createLogger("sendServiceResult");

/**
 * Converte respostas de serviços no formato `{ error: string }` em status HTTP.
 * Usado por auth, perfil e portfólio quando o serviço retorna erro sem lançar exceção.
 */
function statusFromServiceError(errorMessage) {
  const msg = String(errorMessage).toLowerCase();

  if (msg.includes("não autenticado")) return 401;
  if (msg.includes("não encontrado")) return 404;
  if (msg.includes("permissão")) return 403;
  if (msg.includes("já cadastrado")) return 409;
  if (msg.includes("inválidos") || msg.includes("email ou senha")) return 401;
  if (msg.includes("não ativada")) return 403;
  if (msg.includes("expirado")) return 400;
  if (
    msg.includes("obrigatório") ||
    msg.includes("não informado") ||
    msg.includes("inválido")
  ) {
    return 400;
  }

  return 400;
}

function sendServiceResult(res, result, successStatus = 200) {
  if (result && result.error) {
    const status = statusFromServiceError(result.error);
    log.warn("response.error", { error: result.error, status });
    return res.status(status).json(result);
  }
  log.debug("response.success", { status: successStatus });
  return res.status(successStatus).json(result);
}

module.exports = { sendServiceResult, statusFromServiceError };
