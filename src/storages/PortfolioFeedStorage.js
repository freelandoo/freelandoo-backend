// Constrói a query base de candidatos elegíveis para o feed.
// `mode === "new"` adiciona o filtro de novidade/sub-exposição e ordena por
// publicação descendente; `mode === "top"` ordena por engagement_score.
// A elegibilidade espelha a vitrine (SearchStorage) — ver Slice 2B.
function buildCandidateQuery(mode) {
  const newClause =
    mode === "new"
      ? `AND (
            ppi.published_at > NOW() - INTERVAL '72 hours'
            OR ppi.impressions_count < 200
          )`
      : "";

  const orderClause =
    mode === "new"
      ? `ORDER BY ppi.published_at DESC, ppi.id_portfolio_item DESC`
      : `ORDER BY ppi.engagement_score DESC, ppi.published_at DESC, ppi.id_portfolio_item DESC`;

  return `
    SELECT
      ppi.id_portfolio_item                                AS post_id,
      ppi.title,
      ppi.description,
      ppi.project_url,
      CASE
        WHEN cfp.course_id IS NOT NULL THEN 'course'
        ELSE 'portfolio'
      END                                                  AS source_type,
      cfp.course_id                                       AS source_course_id,
      ppi.published_at,
      ppi.likes_count,
      ppi.shares_count,
      ppi.impressions_count,
      ppi.profile_clicks_count,
      ppi.whatsapp_clicks_count,
      ppi.social_clicks_count,
      ppi.comments_count,
      ppi.engagement_score,
      ppi.feed_kind,

      pro.id_profile,
      pro.display_name,
      pro.avatar_url,
      pro.estado,
      pro.municipio,
      pro.is_clan,
      pro.sub_profile_slug,
      pro.xp_level,

      tu.username,

      COALESCE(ca.id_machine, pro.id_machine)              AS id_machine,
      m.slug                                               AS machine_slug,
      m.name                                               AS machine_name,
      m.color_from, m.color_to, m.color_glow,
      m.color_ring, m.color_accent, m.color_text,

      ca.id_category,
      ca.desc_category                                     AS profession_name,
      ca.profession_slug,

      COALESCE(media.media_json,  '[]'::jsonb)             AS media,
      COALESCE(social.links_json, '[]'::jsonb)             AS social_links,
      wa.phone_number_normalized                           AS whatsapp_phone,

      CASE
        WHEN $7::uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM portfolio_likes pl
          WHERE pl.id_portfolio_item = ppi.id_portfolio_item
            AND pl.id_user = $7::uuid
        ) THEN TRUE ELSE FALSE
      END                                                  AS viewer_has_liked

    FROM tb_profile_portfolio_item ppi
    JOIN tb_profile pro       ON pro.id_profile  = ppi.id_profile
    JOIN tb_user    tu        ON tu.id_user      = pro.id_user
    LEFT JOIN tb_category ca  ON ca.id_category  = pro.id_category
    LEFT JOIN tb_machine  m   ON m.id_machine    = COALESCE(ca.id_machine, pro.id_machine)
    LEFT JOIN course_feed_publications cfp
      ON cfp.portfolio_item_id = ppi.id_portfolio_item

    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'url',           ppm.media_url,
          'type',          ppm.media_type,
          'thumbnail_url', ppm.thumbnail_url
        )
        ORDER BY ppm.sort_order, ppm.created_at
      ) AS media_json
      FROM tb_profile_portfolio_media ppm
      WHERE ppm.id_portfolio_item = ppi.id_portfolio_item
        AND ppm.is_active = TRUE
    ) media ON TRUE

    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'social_id', psm.id_profile_social_media,
          'type',      soty.desc_social_media_type,
          'url',       psm.url
        )
        ORDER BY psm.id_profile_social_media
      ) AS links_json
      FROM tb_profile_social_media psm
      JOIN tb_social_media_type soty
        ON soty.id_social_media_type = psm.id_social_media_type
      WHERE psm.id_profile = pro.id_profile
        AND psm.is_active = TRUE
        AND soty.desc_social_media_type <> 'WhatsApp'
    ) social ON TRUE

    LEFT JOIN LATERAL (
      SELECT psm.phone_number_normalized
      FROM tb_profile_social_media psm
      JOIN tb_social_media_type soty
        ON soty.id_social_media_type = psm.id_social_media_type
      WHERE psm.id_profile = pro.id_profile
        AND psm.is_active = TRUE
        AND soty.desc_social_media_type = 'WhatsApp'
        AND psm.phone_number_normalized IS NOT NULL
      LIMIT 1
    ) wa ON TRUE

    WHERE ppi.status   = 'published'
      AND ppi.is_active = TRUE
      AND tu.ativo      = TRUE
      AND pro.is_active = TRUE
      AND (pro.is_visible = TRUE OR pro.is_user_account = TRUE)
      AND pro.feed_visible = TRUE
      AND pro.deleted_at IS NULL
      AND (m.is_active IS NULL OR m.is_active = TRUE)

      AND (
        pro.is_user_account = TRUE
        OR
        (pro.is_clan = FALSE AND EXISTS (
          SELECT 1 FROM tb_profile_subscription psub
          WHERE psub.id_profile = pro.id_profile
            AND psub.status = 'active'
        ))
        OR
        (pro.is_clan = TRUE AND EXISTS (
          SELECT 1
            FROM tb_clan_member cm
            JOIN tb_profile_subscription psub2
              ON psub2.id_profile = cm.id_member_profile
           WHERE cm.id_clan_profile = pro.id_profile
             AND cm.role = 'owner'
             AND psub2.status = 'active'
        ))
      )

      AND ($1::int  IS NULL OR COALESCE(ca.id_machine, pro.id_machine) = $1)
      AND ($2::int  IS NULL OR ca.id_category = $2)
      AND ($3::text IS NULL OR pro.estado = $3)
      AND ($4::text IS NULL OR pro.municipio ILIKE $4)
      AND ($5::uuid[] IS NULL OR NOT (ppi.id_portfolio_item = ANY($5::uuid[])))
      AND ($8::int IS NULL OR pro.xp_level >= $8)
      AND ($9::text IS NULL OR ppi.feed_kind = $9)

      ${newClause}
    ${orderClause}
    LIMIT $6
  `;
}

const TOP_QUERY = buildCandidateQuery("top");
const NEW_QUERY = buildCandidateQuery("new");

function buildParams({
  id_machine,
  id_category,
  estado,
  municipio,
  exclude_ids,
  viewer_id_user,
  level_min,
  feed_kind,
  limit,
}) {
  return [
    Number.isFinite(id_machine) ? id_machine : null,                 // $1
    Number.isFinite(id_category) ? id_category : null,                // $2
    estado || null,                                                   // $3
    municipio ? `%${municipio}%` : null,                              // $4
    Array.isArray(exclude_ids) && exclude_ids.length ? exclude_ids : null, // $5
    limit,                                                            // $6
    viewer_id_user || null,                                           // $7
    Number.isFinite(level_min) ? level_min : null,                    // $8
    feed_kind === "bees" || feed_kind === "feed" ? feed_kind : null,  // $9 (null = todos)
  ];
}

module.exports = {
  /**
   * Top candidatos por engagement_score (com toda a elegibilidade da vitrine).
   * Slice 6 — usado pelo serviço para montar o pool ranqueado.
   */
  async listTopCandidates(db, params) {
    const r = await db.query(TOP_QUERY, buildParams(params));
    return r.rows;
  },

  /**
   * Candidatos "novos / sub-expostos": published_at < 72h OU impressions_count < 200.
   */
  async listNewCandidates(db, params) {
    const r = await db.query(NEW_QUERY, buildParams(params));
    return r.rows;
  },
};
