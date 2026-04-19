module.exports = {
  async searchCreators(
    db,
    {
      estado,
      municipio,
      platform,
      nicho: _nicho,
      category,
      categories,
      id_machine,
      id_category,
      machine_slug,
      q,
      limit,
      offset,
    }
  ) {
    const catPatterns =
      Array.isArray(categories) && categories.length > 0
        ? categories.map((c) => `%${c}%`)
        : null;

    const result = await db.query(
      `
      SELECT
        -- PROFILE
        pro.id_profile,
        pro.display_name,
        pro.bio,
        pro.avatar_url,
        pro.estado,
        pro.municipio,
        ca.id_category,
        ca.desc_category AS category,

        -- MACHINE
        m.id_machine,
        m.slug  AS machine_slug,
        m.name  AS machine_name,

        -- USER DONO DO PROFILE
        tu.id_user,
        tu.nome AS user_nome,
        tu.avatar AS user_avatar,

        -- STATUS DO PROFILE
        COALESCE(ps.statuses, '[]'::jsonb) AS profile_statuses,

        -- REDES SOCIAIS DO PROFILE
        COALESCE(sm.redes_sociais, '[]'::jsonb) AS redes_sociais

      FROM tb_profile pro
      JOIN tb_user tu
        ON tu.id_user = pro.id_user
      JOIN tb_category ca
        ON ca.id_category = pro.id_category
      LEFT JOIN tb_machine m
        ON m.id_machine = ca.id_machine

      -- Status do profile
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_status', st.id_status,
            'desc_status', st.desc_status
          )
          ORDER BY st.desc_status
        ) AS statuses
        FROM tb_profile_status pps
        JOIN tb_status st
          ON st.id_status = pps.id_status
        WHERE pps.id_profile = pro.id_profile
      ) ps ON TRUE

      -- Redes sociais
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
          AND psm.is_active = true
      ) sm ON TRUE

      WHERE
        tu.ativo = true
        AND pro.is_active = true

        -- Máquina desativada nunca aparece publicamente.
        -- Perfis sem máquina (id_machine NULL) só aparecem quando nenhum
        -- filtro de máquina/profissão é aplicado.
        AND (m.is_active IS NULL OR m.is_active = TRUE)

        -- Não mostrar perfis com taxa pendente
        AND NOT EXISTS (
          SELECT 1
          FROM tb_profile_status pps_block
          JOIN tb_status st_block
            ON st_block.id_status = pps_block.id_status
          WHERE pps_block.id_profile = pro.id_profile
            AND st_block.desc_status = 'taxa_pendente'
        )

        -- Filtros geográficos
        AND ($1::text IS NULL OR pro.estado = $1)
        AND ($2::text IS NULL OR pro.municipio ILIKE $2)

        -- Legacy filters (text-based, compat com chamadas antigas)
        AND (
          ($3::text IS NULL OR ca.desc_category ILIKE $3)
          AND ($8::text[] IS NULL OR ca.desc_category ILIKE ANY($8::text[]))
        )
        AND ($4::text IS NULL OR pro.display_name ILIKE $4 OR pro.bio ILIKE $4)

        -- Filtro de plataforma
        AND (
          $5::text IS NULL
          OR EXISTS (
            SELECT 1
            FROM tb_profile_social_media psm2
            JOIN tb_social_media_type soty2
              ON soty2.id_social_media_type = psm2.id_social_media_type
            WHERE psm2.id_profile = pro.id_profile
              AND psm2.is_active = true
              AND soty2.desc_social_media_type ILIKE $5
          )
        )

        -- Filtros canônicos por ID (taxonomia nova)
        AND ($9::int  IS NULL OR ca.id_machine  = $9)
        AND ($10::int IS NULL OR ca.id_category = $10)

        -- Filtro por slug da máquina (alternativo a id_machine)
        AND ($11::text IS NULL OR m.slug = $11)

      ORDER BY pro.display_name
      LIMIT $6 OFFSET $7;
      `,
      [
        estado || null,                            // $1
        municipio ? `%${municipio}%` : null,       // $2
        category ? `%${category}%` : null,         // $3
        q ? `%${q}%` : null,                       // $4
        platform ? `%${platform}%` : null,         // $5
        limit,                                     // $6
        offset,                                    // $7
        catPatterns,                               // $8
        Number.isFinite(id_machine) ? id_machine : null,   // $9
        Number.isFinite(id_category) ? id_category : null, // $10
        machine_slug || null,                      // $11
      ]
    );

    return result.rows;
  },
};
