// src/storages/AcademySocialStorage.js
// Persistência do social da academia (mig 179): posts, metas e ranking mensal.
module.exports = {
  // ─── Posts ─────────────────────────────────────────────────────────────────
  async createPost(db, p) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_post
         (id_academy, id_user, caption, media_url, thumbnail_url, media_kind)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [p.id_academy, p.id_user, p.caption || null, p.media_url || null, p.thumbnail_url || null, p.media_kind || null]
    );
    return r.rows[0];
  },

  async getPostById(db, id_post) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_post WHERE id_post = $1 AND deleted_at IS NULL`,
      [id_post]
    );
    return r.rows[0] || null;
  },

  async listPosts(db, id_academy, { limit = 20, before } = {}) {
    const vals = [id_academy];
    let cursorClause = "";
    if (before) {
      vals.push(before);
      cursorClause = `AND p.created_at < $${vals.length}`;
    }
    vals.push(limit);
    const r = await db.query(
      `SELECT p.*, u.username, u.nome AS user_nome
         FROM public.tb_academy_post p
         JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE p.id_academy = $1 AND p.deleted_at IS NULL ${cursorClause}
        ORDER BY p.created_at DESC
        LIMIT $${vals.length}`,
      vals
    );
    return r.rows;
  },

  async softDeletePost(db, id_post) {
    await db.query(`UPDATE public.tb_academy_post SET deleted_at = NOW() WHERE id_post = $1`, [id_post]);
  },

  // ─── Feed no sistema de portfólio (mig 181) ─────────────────────────────────
  // Liga um post/bee (portfolio-item do autor) ao feed da academia. Espelha
  // CommunityStorage.linkFeedItem — o post sobe TAMBÉM no /feed global com a tag.
  async linkFeedItem(db, id_academy, id_portfolio_item, id_author_user) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_feed_item
         (id_academy, id_portfolio_item, id_author_user)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_academy, id_portfolio_item) DO NOTHING
       RETURNING id`,
      [id_academy, id_portfolio_item, id_author_user || null]
    );
    return r.rowCount > 0;
  },

  async unlinkFeedItem(db, id_academy, id_portfolio_item) {
    const r = await db.query(
      `DELETE FROM public.tb_academy_feed_item
        WHERE id_academy = $1 AND id_portfolio_item = $2`,
      [id_academy, id_portfolio_item]
    );
    return r.rowCount > 0;
  },

  // Confirma que o portfolio-item pertence a um perfil do usuário (anti-spoof).
  async itemBelongsToUser(db, id_portfolio_item, id_user) {
    const r = await db.query(
      `SELECT 1
         FROM public.tb_profile_portfolio_item ppi
         JOIN public.tb_profile p ON p.id_profile = ppi.id_profile
        WHERE ppi.id_portfolio_item = $1 AND p.id_user = $2
        LIMIT 1`,
      [id_portfolio_item, id_user]
    );
    return r.rowCount > 0;
  },

  // Feed da academia na MESMA projeção do /feed (reusa PortfolioFeedService
  // .shapeRow). Espelha CommunityStorage.listCommunityFeedPosts — sem o gate de
  // assinatura da vitrine: o que vale é o link + post válido com mídia.
  async listAcademyFeedPosts(db, id_academy, { viewer_id_user, limit, before_ts, before_key } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 12, 1), 24);
    const r = await db.query(
      `SELECT
         ppi.id_portfolio_item                                AS post_id,
         ppi.title, ppi.description, ppi.project_url,
         CASE WHEN cfp.course_id IS NOT NULL THEN 'course' ELSE 'portfolio' END AS source_type,
         cfp.course_id                                        AS source_course_id,
         ppi.published_at, ppi.likes_count, ppi.shares_count,
         ppi.impressions_count, ppi.profile_clicks_count,
         ppi.whatsapp_clicks_count, ppi.social_clicks_count,
         ppi.comments_count, ppi.engagement_score, ppi.feed_kind,
         ppi.audio_track_id, ppi.audio_start_ms,
         aud.title AS audio_title, aud.artist AS audio_artist,
         aud.storage_key AS audio_storage_key, aud.cover_key AS audio_cover_key,
         aud.duration_ms AS audio_duration_ms,
         pro.id_profile, pro.display_name, pro.avatar_url, pro.estado, pro.municipio,
         pro.is_clan, pro.sub_profile_slug, pro.xp_level,
         tu.username,
         COALESCE(ca.id_machine, pro.id_machine)              AS id_machine,
         m.slug AS machine_slug, m.name AS machine_name,
         m.color_from, m.color_to, m.color_glow, m.color_ring, m.color_accent, m.color_text,
         ca.id_category, ca.desc_category AS profession_name, ca.profession_slug,
         COALESCE(media.media_json, '[]'::jsonb)              AS media,
         COALESCE(social.links_json, '[]'::jsonb)             AS social_links,
         wa.phone_number_normalized                           AS whatsapp_phone,
         CASE WHEN $2::uuid IS NOT NULL AND EXISTS (
           SELECT 1 FROM portfolio_likes pl
           WHERE pl.id_portfolio_item = ppi.id_portfolio_item AND pl.id_user = $2::uuid
         ) THEN TRUE ELSE FALSE END                           AS viewer_has_liked,
         CASE WHEN $2::uuid IS NOT NULL AND EXISTS (
           SELECT 1 FROM user_bookmark_item ubi
           WHERE ubi.id_portfolio_item = ppi.id_portfolio_item AND ubi.id_user = $2::uuid
         ) THEN TRUE ELSE FALSE END                           AS viewer_has_bookmarked
       FROM public.tb_academy_feed_item afi
       JOIN public.tb_profile_portfolio_item ppi ON ppi.id_portfolio_item = afi.id_portfolio_item
       JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
       JOIN public.tb_user tu     ON tu.id_user = pro.id_user
       LEFT JOIN public.tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN public.tb_machine  m  ON m.id_machine = COALESCE(ca.id_machine, pro.id_machine)
       LEFT JOIN public.course_feed_publications cfp ON cfp.portfolio_item_id = ppi.id_portfolio_item
       LEFT JOIN public.tb_audio_track aud ON aud.id_audio_track = ppi.audio_track_id AND aud.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'url', ppm.media_url, 'type', ppm.media_type, 'thumbnail_url', ppm.thumbnail_url
         ) ORDER BY ppm.sort_order, ppm.created_at) AS media_json
         FROM public.tb_profile_portfolio_media ppm
         WHERE ppm.id_portfolio_item = ppi.id_portfolio_item AND ppm.is_active = TRUE
       ) media ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'social_id', psm.id_profile_social_media, 'type', soty.desc_social_media_type, 'url', psm.url
         ) ORDER BY psm.id_profile_social_media) AS links_json
         FROM public.tb_profile_social_media psm
         JOIN public.tb_social_media_type soty ON soty.id_social_media_type = psm.id_social_media_type
         WHERE psm.id_profile = pro.id_profile AND psm.is_active = TRUE
           AND soty.desc_social_media_type <> 'WhatsApp'
       ) social ON TRUE
       LEFT JOIN LATERAL (
         SELECT psm.phone_number_normalized
         FROM public.tb_profile_social_media psm
         JOIN public.tb_social_media_type soty ON soty.id_social_media_type = psm.id_social_media_type
         WHERE psm.id_profile = pro.id_profile AND psm.is_active = TRUE
           AND soty.desc_social_media_type = 'WhatsApp'
           AND psm.phone_number_normalized IS NOT NULL
         LIMIT 1
       ) wa ON TRUE
       WHERE afi.id_academy = $1
         AND ppi.status = 'published'
         AND ppi.is_active = TRUE
         AND ppi.is_banned = FALSE
         AND pro.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM public.tb_profile_portfolio_media ppm2
           WHERE ppm2.id_portfolio_item = ppi.id_portfolio_item AND ppm2.is_active = TRUE
         )
         AND ($4::timestamptz IS NULL OR (ppi.published_at, ppi.id_portfolio_item::text) < ($4::timestamptz, $5::text))
       ORDER BY ppi.published_at DESC, ppi.id_portfolio_item DESC
       LIMIT $3`,
      [id_academy, viewer_id_user || null, lim, before_ts || null, before_key || null]
    );
    return r.rows;
  },

  async incrementShare(db, id_post) {
    const r = await db.query(
      `UPDATE public.tb_academy_post SET share_count = share_count + 1
        WHERE id_post = $1 AND deleted_at IS NULL RETURNING share_count`,
      [id_post]
    );
    return r.rows[0] ? r.rows[0].share_count : null;
  },

  // ─── Metas ─────────────────────────────────────────────────────────────────
  async getGoals(db, id_academy) {
    const r = await db.query(`SELECT * FROM public.tb_academy_goal WHERE id_academy = $1`, [id_academy]);
    return (
      r.rows[0] || { id_academy, freq_target_month: 12, posts_target_month: 4, shares_target_month: 4 }
    );
  },

  async setGoals(db, id_academy, { freq_target_month, posts_target_month, shares_target_month }) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_goal (id_academy, freq_target_month, posts_target_month, shares_target_month)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_academy) DO UPDATE SET
         freq_target_month = EXCLUDED.freq_target_month,
         posts_target_month = EXCLUDED.posts_target_month,
         shares_target_month = EXCLUDED.shares_target_month,
         updated_at = NOW()
       RETURNING *`,
      [id_academy, freq_target_month, posts_target_month, shares_target_month]
    );
    return r.rows[0];
  },

  // ─── Ranking mensal ────────────────────────────────────────────────────────
  // Por membro vinculado: dias distintos de catraca, posts e shares recebidos
  // dentro do mês [monthStart, nextMonth).
  async monthlyRanking(db, id_academy, monthStart, nextMonth) {
    const r = await db.query(
      `SELECT m.id_member, m.id_user, u.username, u.nome AS user_nome, m.member_name,
              COALESCE(freq.days, 0)::int AS freq_days,
              COALESCE(posts.n, 0)::int AS posts_count,
              COALESCE(shares.n, 0)::int AS shares_count
         FROM public.tb_academy_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT ev.occurred_at::date) AS days
             FROM public.tb_academy_access_event ev
            WHERE ev.id_member = m.id_member
              AND ev.occurred_at >= $2::date AND ev.occurred_at < $3::date
         ) freq ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS n
             FROM public.tb_academy_post p
            WHERE p.id_academy = m.id_academy AND p.id_user = m.id_user
              AND p.deleted_at IS NULL
              AND p.created_at >= $2::date AND p.created_at < $3::date
         ) posts ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(p.share_count), 0) AS n
             FROM public.tb_academy_post p
            WHERE p.id_academy = m.id_academy AND p.id_user = m.id_user
              AND p.deleted_at IS NULL
              AND p.created_at >= $2::date AND p.created_at < $3::date
         ) shares ON TRUE
        WHERE m.id_academy = $1
        ORDER BY freq_days DESC, posts_count DESC, u.nome ASC NULLS LAST`,
      [id_academy, monthStart, nextMonth]
    );
    return r.rows;
  },
};
