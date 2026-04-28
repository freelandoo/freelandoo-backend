// src/storages/AdminUsersStorage.js
module.exports = {
  async listAllUsers(db) {
    const result = await db.query(`
      SELECT
        tu.id_user,
        tu.nome,
        tu.email,
        tu.estado,
        tu.municipio,
        tu.ativo,
        tu.is_admin,
        tu.created_at,

        -- taxa_paga: tem pelo menos uma assinatura ativa
        COALESCE(sub_stats.has_active_sub, FALSE) AS taxa_paga,
        COALESCE(sub_stats.has_active_sub, FALSE) AS premium,

        -- total gasto: assinaturas pagas + taxa da plataforma em agendamentos pagos
        COALESCE(sub_stats.total_sub_cents, 0) + COALESCE(booking_stats.total_fee_cents, 0) AS total_spent_cents,

        COALESCE(profiles_agg.profiles_count, 0) AS profiles_count,
        COALESCE(profiles_agg.profiles, '[]'::jsonb) AS profiles

      FROM tb_user tu

      -- assinaturas: flag ativa + total pago
      LEFT JOIN LATERAL (
        SELECT
          BOOL_OR(ps.status = 'active') AS has_active_sub,
          SUM(CASE WHEN ps.paid_at IS NOT NULL THEN ps.amount_cents ELSE 0 END) AS total_sub_cents
        FROM tb_profile_subscription ps
        JOIN tb_profile pr ON pr.id_profile = ps.id_profile
        WHERE pr.id_user = tu.id_user
      ) sub_stats ON TRUE

      -- agendamentos: taxa da plataforma em pagamentos confirmados
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(b.platform_fee_amount), 0) AS total_fee_cents
        FROM tb_profile_bookings b
        WHERE b.profile_owner_user_id = tu.id_user
          AND b.payment_status = 'paid'
      ) booking_stats ON TRUE

      -- perfis com sub mais relevante
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS profiles_count,
          jsonb_agg(
            jsonb_build_object(
              'id_profile',               pro.id_profile,
              'display_name',             pro.display_name,
              'category',                 ca.desc_category,
              'machine',                  m.name,
              'machine_slug',             m.slug,
              'is_active',                pro.is_active,
              'is_visible',               pro.is_visible,
              'deleted_at',               pro.deleted_at,
              'created_at',               pro.created_at,
              'is_paid',                  COALESCE(psub.is_paid, FALSE),
              'subscription_status',      psub.sub_status,
              'subscription_paid_at',     psub.paid_at,
              'subscription_amount_cents',psub.amount_cents,
              'total_spent_cents',        COALESCE(psub_total.total, 0)
            )
            ORDER BY pro.created_at DESC
          ) AS profiles
        FROM tb_profile pro
        JOIN tb_category ca ON ca.id_category = pro.id_category
        LEFT JOIN tb_machine m ON m.id_machine = ca.id_machine

        -- assinatura mais relevante do perfil
        LEFT JOIN LATERAL (
          SELECT
            ps.status      AS sub_status,
            ps.paid_at,
            ps.amount_cents,
            (ps.status = 'active') AS is_paid
          FROM tb_profile_subscription ps
          WHERE ps.id_profile = pro.id_profile
          ORDER BY
            CASE ps.status
              WHEN 'active'   THEN 0
              WHEN 'past_due' THEN 1
              WHEN 'pending'  THEN 2
              ELSE 3
            END,
            ps.created_at DESC
          LIMIT 1
        ) psub ON TRUE

        -- total pago neste perfil
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(ps.amount_cents), 0) AS total
          FROM tb_profile_subscription ps
          WHERE ps.id_profile = pro.id_profile
            AND ps.paid_at IS NOT NULL
        ) psub_total ON TRUE

        WHERE pro.id_user = tu.id_user
          AND pro.deleted_at IS NULL
      ) profiles_agg ON TRUE

      ORDER BY tu.created_at DESC
    `);

    return result.rows;
  },
};
