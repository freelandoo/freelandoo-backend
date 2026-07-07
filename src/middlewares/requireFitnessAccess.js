// src/middlewares/requireFitnessAccess.js
// Gate do painel fitness (decisão do Alex): só acessa quem tem matrícula ATIVA
// em alguma academia vinculada OU assinatura de subperfil ativa. Usar DEPOIS
// do authMiddleware. 403 com code 'fitness_locked' → o front mostra a tela de
// venda ("vincule sua academia ou assine um subperfil").
const pool = require("../databases");
const { createLogger } = require("../utils/logger");

const log = createLogger("fitness-gate");

async function requireFitnessAccess(req, res, next) {
  try {
    const id_user = req.user.id_user;
    const member = await pool.query(
      `SELECT 1 FROM public.tb_academy_member
        WHERE id_user = $1 AND membership_status = 'active' LIMIT 1`,
      [id_user]
    );
    if (member.rowCount > 0) {
      req.fitnessAccess = { via: "academy" };
      return next();
    }
    const sub = await pool.query(
      `SELECT 1
         FROM public.tb_profile pro
         JOIN public.tb_profile_subscription psub
           ON psub.id_profile = pro.id_profile AND psub.status = 'active'
        WHERE pro.id_user = $1 AND pro.deleted_at IS NULL
        LIMIT 1`,
      [id_user]
    );
    if (sub.rowCount > 0) {
      req.fitnessAccess = { via: "subscription" };
      return next();
    }
    return res.status(403).json({
      error: "Painel fitness disponível para matriculados em academia parceira ou assinantes.",
      code: "fitness_locked",
    });
  } catch (err) {
    log.error("gate.fail", { error: err.message });
    return res.status(500).json({ error: "Erro ao verificar acesso" });
  }
}

module.exports = requireFitnessAccess;
