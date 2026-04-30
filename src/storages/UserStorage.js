// src/storages/UserStorage.js
module.exports = {
  async getUserWithSocialById(db, id_user) {
    const result = await db.query(
      `
      SELECT
        -- Dados do usuário
        tu.id_user,
        tu.avatar,
        tu.nome,
        tu.username,
        tu.data_nascimento,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, tu.data_nascimento)) AS idade,
        tu.sexo,
        tu.email,
        tu.telefone,
        tu.ativo,
        tu.bio,
        tu.estado,
        tu.municipio,
        
        -- Roles (nível do user)
        COALESCE(r.roles, '[]'::jsonb) AS roles,

        -- Status da conta (nível do user)
        COALESCE(s.statuses, '[]'::jsonb) AS statuses,

        -- Perfis com redes sociais filhas + status do perfil
        COALESCE(p.profiles, '[]'::jsonb) AS profiles

      FROM tb_user tu
 
      -- roles
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_role', ro.id_role,
            'desc_role', ro.desc_role
          )
          ORDER BY ro.id_role
        ) AS roles
        FROM tb_user_role ur
        JOIN tb_role ro ON ro.id_role = ur.id_role
        WHERE ur.id_user = tu.id_user
      ) r ON TRUE

      -- statuses (user)
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_status', st.id_status,
            'desc_status', st.desc_status
          )
          ORDER BY st.desc_status
        ) AS statuses
        FROM tb_user_status us
        JOIN tb_status st ON st.id_status = us.id_status
        WHERE us.id_user = tu.id_user
      ) s ON TRUE

      -- perfis (multi-perfil) + redes sociais + status do perfil + assinatura
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_profile', pro.id_profile,
            'display_name', pro.display_name,
            'is_clan', pro.is_clan,
            'id_category', pro.id_category,
            'category', ca.desc_category,
            'profession_slug', ca.profession_slug,
            'sub_profile_slug', pro.sub_profile_slug,
            'id_machine', COALESCE(ca.id_machine, pro.id_machine),
            'machine_slug', m.slug,
            'machine_name', m.name,
            'bio', pro.bio,
            'avatar_url', pro.avatar_url,
            'estado', pro.estado,
            'municipio', pro.municipio,
            'is_active', pro.is_active,
            'is_visible', pro.is_visible,
            'deleted_at', pro.deleted_at,
            'redes_sociais', COALESCE(sm.redes_sociais, '[]'::jsonb),
            'statuses',      COALESCE(ps.statuses,      '[]'::jsonb),
            'subscription',  sub.subscription,
            'is_paid',       COALESCE(sub.is_paid, FALSE),
            'is_published',  (COALESCE(sub.is_paid, FALSE) AND pro.is_visible AND pro.deleted_at IS NULL)
          )
          ORDER BY pro.created_at DESC
        ) AS profiles
        FROM tb_profile pro
        LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
        LEFT JOIN tb_machine m ON m.id_machine = COALESCE(ca.id_machine, pro.id_machine)

        -- redes sociais do profile (filhas)
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'social_id', psm.id_profile_social_media,
              'url', psm.url,
              'social_media_type', soty.desc_social_media_type,
              'follower_range', fr.follower_range
            )
            ORDER BY psm.id_profile_social_media
          ) AS redes_sociais
          FROM tb_profile_social_media psm
          JOIN tb_social_media_type soty
            ON soty.id_social_media_type = psm.id_social_media_type
          JOIN tb_follower_range fr
            ON fr.id_follower_range = psm.id_follower_range
          WHERE psm.id_profile = pro.id_profile
        ) sm ON TRUE

        -- statuses do profile (filhas)
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id_status', st.id_status,
              'desc_status', st.desc_status
            )
            ORDER BY st.desc_status
          ) AS statuses
          FROM tb_profile_status pps
          JOIN tb_status st ON st.id_status = pps.id_status
          WHERE pps.id_profile = pro.id_profile
        ) ps ON TRUE

        -- assinatura mais relevante do perfil + flag de "publicado"
        LEFT JOIN LATERAL (
          SELECT
            jsonb_build_object(
              'id_subscription', psub.id_subscription,
              'status', psub.status,
              'amount_cents', psub.amount_cents,
              'currency', psub.currency,
              'current_period_start', psub.current_period_start,
              'current_period_end', psub.current_period_end,
              'paid_at', psub.paid_at,
              'canceled_at', psub.canceled_at
            ) AS subscription,
            (psub.status = 'active') AS is_paid
          FROM tb_profile_subscription psub
          WHERE psub.id_profile = pro.id_profile
          ORDER BY
            CASE psub.status
              WHEN 'active'   THEN 0
              WHEN 'past_due' THEN 1
              WHEN 'pending'  THEN 2
              ELSE 3
            END,
            psub.created_at DESC
          LIMIT 1
        ) sub ON TRUE

        WHERE pro.id_user = tu.id_user
          AND pro.deleted_at IS NULL
      ) p ON TRUE

      WHERE tu.id_user = $1
      `,
      [id_user]
    );

    return result.rows[0] || null;
  },

  async updateUserById(db, id_user, patch) {
    const fields = [];
    const values = [];
    let index = 1;

    const allowed = [
      "nome",
      "username",
      "data_nascimento",
      "sexo",
      "telefone",
      "bio",
      "estado",
      "municipio",
      "id_nicho",
    ];

    for (const key of allowed) {
      if (
        patch[key] !== undefined &&
        patch[key] !== null &&
        patch[key] !== ""
      ) {
        fields.push(`${key} = $${index++}`);
        values.push(patch[key]);
      }
    }

    if (fields.length === 0) return null;

    values.push(id_user);

    const result = await db.query(
      `
      UPDATE tb_user
      SET ${fields.join(", ")}
      WHERE id_user = $${index}
      RETURNING id_user, nome, username, data_nascimento, sexo, bio, estado, municipio, id_nicho
      `,
      values
    );

    return result.rows[0] || null;
  },

  async updateAvatarById(db, id_user, avatarUrl) {
    const result = await db.query(
      `
      UPDATE tb_user
      SET avatar = $1
      WHERE id_user = $2
      RETURNING id_user, avatar
      `,
      [avatarUrl, id_user]
    );

    return result.rows[0] || null;
  },
};
