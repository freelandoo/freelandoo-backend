// src/storages/ExpiringStorage.js
// Consultas de "expira em breve" para os avisos do sino (Slice E financeiro).
// Cada uma devolve { entity_id (PK da linha), id_user (dono), expires_at }.
// O job NotificationService.sweepExpiring chama as 3 e notifica com dedupe.
const pool = require("../databases");

const ExpiringStorage = {
  // Assinatura de subperfil (anual). Dono = tb_profile.id_user.
  async subscriptionsExpiringSoon(days = 3) {
    const r = await pool.query(
      `SELECT s.id_subscription AS entity_id, p.id_user, s.current_period_end AS expires_at
         FROM public.tb_profile_subscription s
         JOIN public.tb_profile p ON p.id_profile = s.id_profile
        WHERE s.status = 'active'
          AND s.current_period_end IS NOT NULL
          AND s.current_period_end > NOW()
          AND s.current_period_end < NOW() + ($1 || ' days')::interval`,
      [String(days)]
    );
    return r.rows;
  },

  // Destaque pago (premium). Dono = tb_profile.id_user.
  async premiumExpiringSoon(days = 3) {
    const r = await pool.query(
      `SELECT pp.id AS entity_id, p.id_user, pp.expires_at
         FROM public.profile_premium pp
         JOIN public.tb_profile p ON p.id_profile = pp.profile_id
        WHERE pp.status = 'active'
          AND pp.expires_at IS NOT NULL
          AND pp.expires_at > NOW()
          AND pp.expires_at < NOW() + ($1 || ' days')::interval`,
      [String(days)]
    );
    return r.rows;
  },

  // Manifestação (banner+tag). user_id já é o dono.
  async manifestationsExpiringSoon(days = 3) {
    const r = await pool.query(
      `SELECT id AS entity_id, user_id AS id_user, expires_at
         FROM public.user_manifestations
        WHERE is_active = TRUE
          AND expires_at > NOW()
          AND expires_at < NOW() + ($1 || ' days')::interval`,
      [String(days)]
    );
    return r.rows;
  },
};

module.exports = ExpiringStorage;
