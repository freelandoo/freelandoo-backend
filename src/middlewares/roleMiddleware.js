const pool = require("../databases");
const { createLogger } = require("../utils/logger");
const adminAudit = require("../utils/adminAudit");

const log = createLogger("roleMiddleware");

// `audit` (padrão: ligado): toda ação que muda algo e passou pela trava vira uma linha em
// tb_admin_audit_log (utils/adminAudit.js, Segurança A1 lote 7). Só a porta do JOGADOR do
// Meu Mundo (o jogo fechado usa o papel como porta) desliga, para a trilha não virar log de jogo.
function roleMiddleware(requiredRoles, { audit = true } = {}) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

  return async (req, res, next) => {
    const { id_user } = req.user || {};

    if (!id_user) {
      log.warn("missing_user", { path: req.originalUrl || req.url });
      return res.status(401).json({ error: "Não autorizado" });
    }

    try {
      const { rows } = await pool.query(
        `
        SELECT 1
        FROM tb_user_role ur
        JOIN tb_role r ON r.id_role = ur.id_role
        WHERE ur.id_user = $1
          AND ur.is_active = TRUE
          AND r.is_active = TRUE
          AND r.desc_role = ANY($2::text[])
        LIMIT 1
        `,
        [id_user, roles]
      );

      if (rows.length === 0) {
        log.warn("forbidden", {
          id_user,
          requiredRoles: roles,
          path: req.originalUrl || req.url,
        });
        return res
          .status(403)
          .json({ error: "Acesso negado: permissão insuficiente" });
      }

      if (audit) adminAudit.arm(req, res);
      return next();
    } catch (err) {
      log.error("handler.fail", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  };
}

module.exports = roleMiddleware;
