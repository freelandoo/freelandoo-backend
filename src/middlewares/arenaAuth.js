// Guard da Freelandoo Arena (Módulo 04).
//
// Por que não o `authMiddleware` global: ele é JWT PURO, sem I/O — de
// propósito, porque roda em toda rota do site. Mas isso quer dizer que um
// token emitido ANTES de a conta ser bloqueada (ou apagada) continua valendo
// até expirar (TTL 1 dia). Para a Arena isso não serve: aqui o estado da conta
// é conferido no banco a cada operação. A mudança é LOCAL — nenhuma outra rota
// da plataforma muda de comportamento.
//
// Contrato de erro (JSON { error, code }):
//   401 missing_token | invalid_token | account_not_found  → precisa entrar de novo
//   403 account_blocked | account_inactive | supervision_inactive → identidade
//       reconhecida, acesso recusado (NÃO é logout)
//   503 identity_unavailable → banco fora: falha FECHADA, sessão preservada
//
// O token nunca é registrado em log; só o código do motivo e o caminho.

const jwt = require("jsonwebtoken");
const ArenaStorage = require("../storages/ArenaStorage");
const { isUuid } = require("../utils/arenaRules");
const { createLogger } = require("../utils/logger");

const log = createLogger("arenaAuth");

// Três segmentos base64url. Qualquer outra coisa (espaço a mais, "Bearer"
// faltando, JSON cru) é recusada antes do verify.
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/;

function deny(res, status, code, error) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error, code });
}

function createArenaAuth({ storage = ArenaStorage, pool, secret = () => process.env.JWT_SECRET } = {}) {
  return async function arenaAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return deny(res, 401, "missing_token", "Sessão da Freelandoo não informada");
    const match = BEARER.exec(String(header));
    if (!match) return deny(res, 401, "invalid_token", "Sessão inválida");

    let decoded;
    try {
      // HS256 é o que a plataforma emite (jwt.sign sem algorithm = HS256).
      // Fixar a lista impede "none" e troca de algoritmo. Sem issuer/audience:
      // a plataforma não os emite, e exigir derrubaria toda sessão existente.
      decoded = jwt.verify(match[1], secret(), { algorithms: ["HS256"] });
    } catch (err) {
      const expired = err && err.name === "TokenExpiredError";
      log.info("token.rejected", { path: req.originalUrl, reason: expired ? "expired" : "invalid" });
      return deny(res, 401, "invalid_token", expired ? "Sessão expirada" : "Sessão inválida");
    }
    if (!decoded || typeof decoded !== "object" || !isUuid(decoded.id_user)) {
      return deny(res, 401, "invalid_token", "Sessão inválida");
    }

    let account;
    try {
      account = await storage.getAccountState(pool, decoded.id_user);
    } catch (err) {
      log.error("account_state.fail", { path: req.originalUrl, message: err?.message });
      return deny(res, 503, "identity_unavailable", "Não foi possível confirmar a sessão agora");
    }
    if (!account) return deny(res, 401, "account_not_found", "Conta não encontrada");
    if (account.blocked_at) return deny(res, 403, "account_blocked", "Conta bloqueada");
    // `ativo = FALSE` é tanto "e-mail não confirmado" quanto "conta apagada"
    // (o DeleteMeService só desliga a flag). Os dois ficam fora da Arena.
    if (!account.ativo) return deny(res, 403, "account_inactive", "Conta inativa ou e-mail não confirmado");
    // Menor só entra com o vínculo de supervisão ATIVO (mesma regra de
    // `assertLinkActiveIfMinor`): suspenso ou revogado pelo responsável = fora.
    if (account.is_minor && account.link_status !== "active") {
      return deny(res, 403, "supervision_inactive", "A conta supervisionada não está liberada pelo responsável");
    }

    req.arena = {
      id_user: account.id_user,
      username: account.username || null,
      is_minor: !!account.is_minor,
    };
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Authorization");
    return next();
  };
}

module.exports = { createArenaAuth };
