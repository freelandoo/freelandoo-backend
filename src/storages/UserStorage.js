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

      -- perfis (multi-perfil) + redes sociais + status do perfil
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_profile', pro.id_profile,
            'display_name', pro.display_name,
            'category', ca.desc_category,
            'bio', pro.bio,
            'avatar_url', pro.avatar_url,
            'estado', pro.estado,
            'municipio', pro.municipio,
            'redes_sociais', COALESCE(sm.redes_sociais, '[]'::jsonb),
            'statuses',      COALESCE(ps.statuses,      '[]'::jsonb)
          )
          ORDER BY pro.id_profile
        ) AS profiles
        FROM tb_profile pro
        JOIN tb_category ca ON ca.id_category = pro.id_category

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

        WHERE pro.id_user = tu.id_user
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
