// src/middlewares/requireAiAccess.js
// Guarda das rotas de configuração do atendente.
//
// ⚠️ A REGRA NÃO MORA AQUI — mora em `utils/aiAccess.canUseAi`, porque o WORKER
// faz a mesma pergunta e as duas respostas não podem divergir. Este arquivo é
// só a tradução da resposta para HTTP. Ver o comentário de lá para o porquê de
// hoje ser só o administrador e para como se abre.
const pool = require("../databases");
const { canUseAi } = require("../utils/aiAccess");
const { createLogger } = require("../utils/logger");

const log = createLogger("requireAiAccess");

module.exports = async function requireAiAccess(req, res, next) {
  try {
    if (!req.user?.id_user) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    if (!(await canUseAi(pool, req.user.id_user))) {
      log.warn("denied", { id_user: req.user.id_user });
      return res.status(403).json({
        error:
          "O Atendimento com IA ainda está em teste fechado com a administração da plataforma.",
      });
    }

    return next();
  } catch (err) {
    log.error("fail", { error: err.message });
    return res.status(500).json({ error: "Falha ao verificar o acesso." });
  }
};
