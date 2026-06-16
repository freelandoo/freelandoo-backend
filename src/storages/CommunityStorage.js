// src/storages/CommunityStorage.js
// SQL puro da Comunidade (tipo is_community em tb_profile). Membros são USERS.
// Espelha o estilo de ClanStorage: métodos estáticos recebendo `conn`.

const ProfileStorage = require("./ProfileStorage");

class CommunityStorage {
  // ─── Entitlement (tetos por user) ───────────────────────────────────────────
  // Garante a linha default (1/1) e devolve os tetos atuais.
  static async getEntitlement(conn, id_user) {
    await conn.query(
      `INSERT INTO public.tb_community_entitlement (id_user)
         VALUES ($1)
       ON CONFLICT (id_user) DO NOTHING`,
      [id_user]
    );
    const r = await conn.query(
      `SELECT id_user, create_cap, member_cap, updated_at
         FROM public.tb_community_entitlement
        WHERE id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return r.rows[0];
  }

  static async countOwned(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_profile
        WHERE id_leader_user = $1
          AND is_community = TRUE
          AND deleted_at IS NULL`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async countMemberships(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_community_member m
         JOIN public.tb_profile p ON p.id_profile = m.id_community_profile
        WHERE m.id_user = $1
          AND p.deleted_at IS NULL`,
      [id_user]
    );
    return r.rows[0].n;
  }

  // Nível/XP do user = subperfil (não-clã, não-comunidade) de maior XP.
  // has_subprofile = se o user tem ao menos 1 subperfil ativo.
  static async getHighestSubprofile(conn, id_user) {
    const r = await conn.query(
      `SELECT COALESCE(MAX(xp_level), 0)::int       AS lvl,
              COALESCE(MAX(xp_total), 0)::numeric    AS xp,
              COUNT(*)::int                          AS subprofiles
         FROM public.tb_profile
        WHERE id_user = $1
          AND is_clan = FALSE
          AND is_community = FALSE
          AND deleted_at IS NULL`,
      [id_user]
    );
    const row = r.rows[0];
    return {
      lvl: Number(row.lvl) || 0,
      xp: Number(row.xp) || 0,
      has_subprofile: Number(row.subprofiles) > 0,
    };
  }

  // ─── Criação ────────────────────────────────────────────────────────────────
  static async createCommunity(
    conn,
    { id_user, id_machine, display_name, bio, avatar_url, theme }
  ) {
    // tb_profile.sub_profile_slug é NOT NULL — gera um slug único por user
    // (mesma convenção dos subperfis: slugify(display_name) + sufixo anti-colisão).
    const sub_profile_slug = await ProfileStorage.resolveUniqueSubProfileSlug(
      conn,
      { id_user, display_name }
    );

    const r = await conn.query(
      `INSERT INTO public.tb_profile
         (id_user, id_category, id_machine, is_community, id_leader_user,
          community_theme, display_name, bio, avatar_url, sub_profile_slug)
       VALUES
         ($1, NULL, $2, TRUE, $1, $3, $4, $5, $6, $7)
       RETURNING id_profile, id_user, id_machine, is_community, id_leader_user,
                 community_theme, display_name, bio, avatar_url, sub_profile_slug,
                 is_active, is_visible, xp_total, xp_level, created_at, updated_at`,
      [
        id_user,
        id_machine,
        theme ? JSON.stringify(theme) : null,
        display_name,
        bio ?? null,
        avatar_url ?? null,
        sub_profile_slug,
      ]
    );
    return r.rows[0];
  }

  // ─── Edição de perfil (só líder; guard no service) ──────────────────────────
  static async updateProfile(conn, id_community, { display_name, bio }) {
    const sets = ["updated_at = NOW()"];
    const vals = [id_community];
    let idx = 2;
    if (display_name !== undefined) {
      sets.push(`display_name = $${idx++}`);
      vals.push(display_name);
    }
    if (bio !== undefined) {
      sets.push(`bio = $${idx++}`);
      vals.push(bio);
    }
    const r = await conn.query(
      `UPDATE public.tb_profile SET ${sets.join(", ")}
        WHERE id_profile = $1 AND is_community = TRUE AND deleted_at IS NULL
        RETURNING id_profile, display_name, bio`,
      vals
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async setAvatar(conn, id_community, avatar_url) {
    const r = await conn.query(
      `UPDATE public.tb_profile SET avatar_url = $2, updated_at = NOW()
        WHERE id_profile = $1 AND is_community = TRUE AND deleted_at IS NULL
        RETURNING id_profile, avatar_url`,
      [id_community, avatar_url]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async setBanner(conn, id_community, banner_url) {
    const r = await conn.query(
      `UPDATE public.tb_profile SET community_banner_url = $2, updated_at = NOW()
        WHERE id_profile = $1 AND is_community = TRUE AND deleted_at IS NULL
        RETURNING id_profile, community_banner_url AS banner_url`,
      [id_community, banner_url]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Leitura ─────────────────────────────────────────────────────────────────
  static async getById(conn, id_community) {
    const r = await conn.query(
      `SELECT p.id_profile, p.id_machine, p.is_community, p.id_leader_user,
              p.community_theme, p.display_name, p.bio, p.avatar_url,
              p.community_banner_url AS banner_url,
              p.xp_total, p.xp_level, p.created_at, p.updated_at,
              m.name AS enxame_name,
              (SELECT COUNT(*)::int FROM public.tb_community_member cm
                WHERE cm.id_community_profile = p.id_profile) AS member_count
         FROM public.tb_profile p
         LEFT JOIN public.tb_machine m ON m.id_machine = p.id_machine
        WHERE p.id_profile = $1
          AND p.is_community = TRUE
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [id_community]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listPublic(conn, { q, id_machine, limit = 30, offset = 0 } = {}) {
    const params = [];
    const where = ["p.is_community = TRUE", "p.deleted_at IS NULL"];
    if (q) {
      params.push(`%${q}%`);
      where.push(`p.display_name ILIKE $${params.length}`);
    }
    if (id_machine) {
      params.push(id_machine);
      where.push(`p.id_machine = $${params.length}`);
    }
    params.push(Math.min(Number(limit) || 30, 60));
    params.push(Number(offset) || 0);
    const r = await conn.query(
      `SELECT p.id_profile, p.id_machine, p.display_name, p.avatar_url,
              p.community_banner_url AS banner_url,
              p.community_theme, p.xp_total, p.xp_level,
              m.name AS enxame_name,
              (SELECT COUNT(*)::int FROM public.tb_community_member cm
                WHERE cm.id_community_profile = p.id_profile) AS member_count
         FROM public.tb_profile p
         LEFT JOIN public.tb_machine m ON m.id_machine = p.id_machine
        WHERE ${where.join(" AND ")}
        ORDER BY p.xp_total DESC, p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  // Comunidades em que o user participa (qualquer papel), com seu papel.
  static async listForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT p.id_profile, p.id_machine, p.display_name, p.avatar_url,
              p.community_banner_url AS banner_url,
              p.community_theme, p.xp_total, p.xp_level,
              m.role,
              mac.name AS enxame_name,
              (SELECT COUNT(*)::int FROM public.tb_community_member cm
                WHERE cm.id_community_profile = p.id_profile) AS member_count
         FROM public.tb_community_member m
         JOIN public.tb_profile p ON p.id_profile = m.id_community_profile
         LEFT JOIN public.tb_machine mac ON mac.id_machine = p.id_machine
        WHERE m.id_user = $1
          AND p.is_community = TRUE
          AND p.deleted_at IS NULL
        ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END,
                 m.joined_at ASC`,
      [id_user]
    );
    return r.rows;
  }

  static async updateTheme(conn, id_community, theme) {
    const r = await conn.query(
      `UPDATE public.tb_profile
          SET community_theme = $2, updated_at = NOW()
        WHERE id_profile = $1 AND is_community = TRUE AND deleted_at IS NULL
        RETURNING id_profile, community_theme`,
      [id_community, theme ? JSON.stringify(theme) : null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Membros (user-level) ─────────────────────────────────────────────────────
  static async addMember(conn, id_community, id_user, role = "member") {
    const r = await conn.query(
      `INSERT INTO public.tb_community_member (id_community_profile, id_user, role)
         VALUES ($1, $2, $3)
       ON CONFLICT (id_community_profile, id_user) DO NOTHING
       RETURNING id_community_profile, id_user, role, joined_at`,
      [id_community, id_user, role]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async removeMember(conn, id_community, id_user) {
    const r = await conn.query(
      `DELETE FROM public.tb_community_member
        WHERE id_community_profile = $1 AND id_user = $2`,
      [id_community, id_user]
    );
    return r.rowCount > 0;
  }

  static async getMembership(conn, id_community, id_user) {
    const r = await conn.query(
      `SELECT id_community_profile, id_user, role, joined_at
         FROM public.tb_community_member
        WHERE id_community_profile = $1 AND id_user = $2
        LIMIT 1`,
      [id_community, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listMembers(conn, id_community) {
    const r = await conn.query(
      `SELECT m.id_user, m.role, m.joined_at,
              u.nome AS user_name,
              u.username AS user_username,
              hp.id_profile AS top_profile_id,
              hp.display_name AS top_profile_name,
              hp.avatar_url AS top_profile_avatar,
              hp.xp_level AS top_profile_level,
              COALESCE(hp.xp_total, 0) AS top_profile_xp
         FROM public.tb_community_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         LEFT JOIN LATERAL (
           SELECT id_profile, display_name, avatar_url, xp_level, xp_total
             FROM public.tb_profile
            WHERE id_user = m.id_user
              AND is_clan = FALSE
              AND is_community = FALSE
              AND deleted_at IS NULL
            ORDER BY xp_total DESC
            LIMIT 1
         ) hp ON TRUE
        WHERE m.id_community_profile = $1
        ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END,
                 m.joined_at ASC`,
      [id_community]
    );
    return r.rows;
  }

  // ─── Benchmark: posição da comunidade entre as do mesmo enxame ───────────────
  static async getBenchmark(conn, id_community) {
    const r = await conn.query(
      `WITH ranked AS (
         SELECT id_profile, id_machine, xp_total, xp_level,
                ROW_NUMBER() OVER (PARTITION BY id_machine ORDER BY xp_total DESC, created_at ASC) AS pos,
                COUNT(*)     OVER (PARTITION BY id_machine) AS total
           FROM public.tb_profile
          WHERE is_community = TRUE AND deleted_at IS NULL
       )
       SELECT r.pos::int AS position, r.total::int AS total,
              r.xp_total, r.xp_level, m.name AS enxame_name
         FROM ranked r
         LEFT JOIN public.tb_machine m ON m.id_machine = r.id_machine
        WHERE r.id_profile = $1
        LIMIT 1`,
      [id_community]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Meta = Temporada (ranking por métrica + prêmio ao #1) ───────────────────
  static GOAL_METRICS = ["xp", "posts", "shares"];

  static async getActiveGoalRow(conn, id_community) {
    const r = await conn.query(
      `SELECT id, id_community_profile, title, metric, target_value, prize_polens,
              status, winner_user_id, prize_paid, starts_at, ends_at, closed_at, created_at
         FROM public.tb_community_goal
        WHERE id_community_profile = $1 AND is_active = TRUE
        LIMIT 1`,
      [id_community]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Ranking dos membros por métrica, dentro de [starts_at, asOf]. Identidade via
  // subperfil de maior XP. Retorna ordenado desc (já com score normalizado).
  static async getGoalRanking(conn, goal, asOf) {
    const ident = `
      LEFT JOIN LATERAL (
        SELECT display_name, avatar_url, xp_level, xp_total
          FROM public.tb_profile
         WHERE id_user = m.id_user AND is_clan = FALSE AND is_community = FALSE AND deleted_at IS NULL
         ORDER BY xp_total DESC LIMIT 1
      ) hp ON TRUE`;
    const idc = goal.id_community_profile;

    if (goal.metric === "posts") {
      const r = await conn.query(
        `SELECT m.id_user, u.nome AS user_name, u.username,
                hp.display_name, hp.avatar_url, hp.xp_level,
                COUNT(cfi.id)::int AS posts,
                COALESCE(SUM(COALESCE(ppi.likes_count,0) + COALESCE(ppi.comments_count,0)),0)::int AS eng
           FROM public.tb_community_member m
           JOIN public.tb_user u ON u.id_user = m.id_user
           ${ident}
           LEFT JOIN public.tb_community_feed_item cfi
             ON cfi.id_community_profile = $1 AND cfi.id_author_user = m.id_user
            AND cfi.created_at >= $2 AND cfi.created_at <= $3
           LEFT JOIN public.tb_profile_portfolio_item ppi
             ON ppi.id_portfolio_item = cfi.id_portfolio_item
          WHERE m.id_community_profile = $1
          GROUP BY m.id_user, u.nome, u.username, hp.display_name, hp.avatar_url, hp.xp_level
          ORDER BY eng DESC, posts DESC`,
        [idc, goal.starts_at, asOf]
      );
      return r.rows.map((x) => ({ ...x, posts: Number(x.posts), eng: Number(x.eng), score: Number(x.eng) }));
    }

    if (goal.metric === "shares") {
      const r = await conn.query(
        `SELECT m.id_user, u.nome AS user_name, u.username,
                hp.display_name, hp.avatar_url, hp.xp_level,
                COUNT(sr.id)::int AS score
           FROM public.tb_community_member m
           JOIN public.tb_user u ON u.id_user = m.id_user
           ${ident}
           LEFT JOIN public.tb_community_share_return sr
             ON sr.id_community_profile = $1 AND sr.id_member_user = m.id_user
            AND sr.created_at >= $2 AND sr.created_at <= $3
          WHERE m.id_community_profile = $1
          GROUP BY m.id_user, u.nome, u.username, hp.display_name, hp.avatar_url, hp.xp_level
          ORDER BY score DESC`,
        [idc, goal.starts_at, asOf]
      );
      return r.rows.map((x) => ({ ...x, score: Number(x.score) }));
    }

    // xp (default): delta = XP atual − baseline capturado no início.
    const r = await conn.query(
      `SELECT m.id_user, u.nome AS user_name, u.username,
              hp.display_name, hp.avatar_url, hp.xp_level,
              GREATEST(0, COALESCE(hp.xp_total,0) - COALESCE(b.baseline_xp, COALESCE(hp.xp_total,0)))::int AS score
         FROM public.tb_community_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         ${ident}
         LEFT JOIN public.tb_community_goal_member b ON b.id_goal = $2 AND b.id_user = m.id_user
        WHERE m.id_community_profile = $1
        ORDER BY score DESC`,
      [idc, goal.id]
    );
    return r.rows.map((x) => ({ ...x, score: Number(x.score) }));
  }

  // Snapshot do XP de cada membro no início (não sobrescreve — late joiners
  // entram com baseline = XP do momento, delta 0).
  static async seedGoalBaselines(conn, id_goal, id_community) {
    await conn.query(
      `INSERT INTO public.tb_community_goal_member (id_goal, id_user, baseline_xp)
       SELECT $1, m.id_user, COALESCE((
                SELECT p.xp_total FROM public.tb_profile p
                 WHERE p.id_user = m.id_user AND p.is_clan = FALSE
                   AND p.is_community = FALSE AND p.deleted_at IS NULL
                 ORDER BY p.xp_total DESC LIMIT 1
              ), 0)
         FROM public.tb_community_member m
        WHERE m.id_community_profile = $2
       ON CONFLICT (id_goal, id_user) DO NOTHING`,
      [id_goal, id_community]
    );
  }

  // Cria/substitui a temporada ativa (desativa a anterior, paga ou não).
  static async setGoal(conn, id_community, { title, metric, target_value, ends_at, prize_polens, created_by_user }) {
    const m = this.GOAL_METRICS.includes(metric) ? metric : "xp";
    await conn.query(
      `UPDATE public.tb_community_goal SET is_active = FALSE, updated_at = NOW()
        WHERE id_community_profile = $1 AND is_active = TRUE`,
      [id_community]
    );
    const r = await conn.query(
      `INSERT INTO public.tb_community_goal
         (id_community_profile, title, metric, target_value, baseline_value,
          ends_at, prize_polens, status, starts_at, created_by_user)
       VALUES ($1, $2, $3, $4, 0, $5, $6, 'active', NOW(), $7)
       RETURNING id`,
      [id_community, title, m, target_value ?? null, ends_at, prize_polens, created_by_user || null]
    );
    const id_goal = r.rows[0].id;
    await this.seedGoalBaselines(conn, id_goal, id_community);
    return id_goal;
  }

  // Encerra a temporada (uma vez só, via guard status='active').
  static async closeGoal(conn, id_goal, winner_user_id) {
    const r = await conn.query(
      `UPDATE public.tb_community_goal
          SET status = 'closed', closed_at = NOW(), winner_user_id = $2
        WHERE id = $1 AND status = 'active'
        RETURNING id`,
      [id_goal, winner_user_id || null]
    );
    return r.rowCount > 0;
  }

  static async markPrizePaid(conn, id_goal) {
    await conn.query(`UPDATE public.tb_community_goal SET prize_paid = TRUE WHERE id = $1`, [id_goal]);
  }

  static async clearGoal(conn, id_community) {
    await conn.query(
      `UPDATE public.tb_community_goal SET is_active = FALSE, updated_at = NOW()
        WHERE id_community_profile = $1 AND is_active = TRUE`,
      [id_community]
    );
    return { ok: true };
  }

  // ─── Feed estilo grupo (posts dos membros) ──────────────────────────────────
  // Liga um post/bee (portfolio-item de um membro) ao feed da comunidade.
  static async linkFeedItem(conn, id_community, id_portfolio_item, id_author_user) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_feed_item
         (id_community_profile, id_portfolio_item, id_author_user)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_community_profile, id_portfolio_item) DO NOTHING
       RETURNING id`,
      [id_community, id_portfolio_item, id_author_user || null]
    );
    return r.rowCount > 0;
  }

  static async unlinkFeedItem(conn, id_community, id_portfolio_item) {
    const r = await conn.query(
      `DELETE FROM public.tb_community_feed_item
        WHERE id_community_profile = $1 AND id_portfolio_item = $2`,
      [id_community, id_portfolio_item]
    );
    return r.rowCount > 0;
  }

  // Confirma que o portfolio-item pertence a um perfil do usuário (anti-spoof).
  static async itemBelongsToUser(conn, id_portfolio_item, id_user) {
    const r = await conn.query(
      `SELECT 1
         FROM public.tb_profile_portfolio_item ppi
         JOIN public.tb_profile p ON p.id_profile = ppi.id_profile
        WHERE ppi.id_portfolio_item = $1 AND p.id_user = $2
        LIMIT 1`,
      [id_portfolio_item, id_user]
    );
    return r.rowCount > 0;
  }

  // Registra um "retorno" via link de share (1 ponto). Só conta se o atribuído
  // é membro; dedupe por (comunidade, membro, post, visitante).
  static async logShareReturn(conn, { id_community, id_member_user, id_portfolio_item, visitor_hash }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_share_return
         (id_community_profile, id_member_user, id_portfolio_item, visitor_hash)
       SELECT $1, $2, $3, $4
        WHERE EXISTS (
          SELECT 1 FROM public.tb_community_member m
           WHERE m.id_community_profile = $1 AND m.id_user = $2
        )
       ON CONFLICT (id_community_profile, id_member_user, id_portfolio_item, visitor_hash) DO NOTHING
       RETURNING id`,
      [id_community, id_member_user, id_portfolio_item, visitor_hash]
    );
    return r.rowCount > 0;
  }

  // Feed unificado (posts + bees, cronológico) na MESMA projeção do /feed.
  // Sem o gate de assinatura da vitrine: o que vale é ser membro + post válido.
  static async listCommunityFeedPosts(conn, id_community, { viewer_id_user, limit, before_ts, before_id }) {
    const lim = Math.min(Math.max(Number(limit) || 12, 1), 24);
    const r = await conn.query(
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
       FROM public.tb_community_feed_item cfi
       JOIN public.tb_profile_portfolio_item ppi ON ppi.id_portfolio_item = cfi.id_portfolio_item
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
       WHERE cfi.id_community_profile = $1
         AND ppi.status = 'published'
         AND ppi.is_active = TRUE
         AND ppi.is_banned = FALSE
         AND pro.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM public.tb_profile_portfolio_media ppm2
           WHERE ppm2.id_portfolio_item = ppi.id_portfolio_item AND ppm2.is_active = TRUE
         )
         AND ($4::timestamptz IS NULL OR (ppi.published_at, ppi.id_portfolio_item) < ($4::timestamptz, $5::uuid))
       ORDER BY ppi.published_at DESC, ppi.id_portfolio_item DESC
       LIMIT $3`,
      [id_community, viewer_id_user || null, lim, before_ts || null, before_id || null]
    );
    return r.rows;
  }

  // ─── Mural do líder (recados) ────────────────────────────────────────────────
  static async listAnnouncements(conn, id_community, limit = 20) {
    const r = await conn.query(
      `SELECT a.id, a.body, a.is_pinned, a.created_at,
              u.username AS author_username, u.nome AS author_name
         FROM public.tb_community_announcement a
         LEFT JOIN public.tb_user u ON u.id_user = a.created_by_user
        WHERE a.id_community_profile = $1
        ORDER BY a.is_pinned DESC, a.created_at DESC
        LIMIT $2`,
      [id_community, Math.min(Number(limit) || 20, 50)]
    );
    return r.rows;
  }

  static async createAnnouncement(conn, id_community, { body, is_pinned, created_by_user }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_announcement
         (id_community_profile, body, is_pinned, created_by_user)
       VALUES ($1, $2, $3, $4)
       RETURNING id, body, is_pinned, created_at`,
      [id_community, body, !!is_pinned, created_by_user || null]
    );
    return r.rows[0];
  }

  static async deleteAnnouncement(conn, id_community, id_announcement) {
    const r = await conn.query(
      `DELETE FROM public.tb_community_announcement
        WHERE id = $1 AND id_community_profile = $2`,
      [id_announcement, id_community]
    );
    return r.rowCount > 0;
  }

  // ─── Feed/Bees da comunidade (itens de portfólio do perfil-comunidade) ──────
  // feed_kind: 'feed' (posts) | 'bees' (vídeos 9:16) | null (todos).
  static async listItems(conn, id_community, feed_kind, limit = 24, offset = 0) {
    const r = await conn.query(
      `SELECT i.id_portfolio_item, i.title, i.description, i.feed_kind,
              i.created_at,
              COALESCE(mq.media, '[]'::jsonb) AS media
         FROM public.tb_profile_portfolio_item i
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_portfolio_media', m.id_portfolio_media,
               'media_url', m.media_url,
               'media_type', m.media_type,
               'thumbnail_url', m.thumbnail_url,
               'sort_order', m.sort_order,
               'width', m.width,
               'height', m.height
             ) ORDER BY m.sort_order, m.created_at
           ) AS media
           FROM public.tb_profile_portfolio_media m
           WHERE m.id_portfolio_item = i.id_portfolio_item AND m.is_active = true
         ) mq ON TRUE
        WHERE i.id_profile = $1
          AND i.is_active = true
          AND i.is_banned = false
          AND ($2::text IS NULL OR i.feed_kind = $2)
        ORDER BY i.created_at DESC
        LIMIT $3 OFFSET $4`,
      [id_community, feed_kind || null, Math.min(Number(limit) || 24, 60), Number(offset) || 0]
    );
    return r.rows;
  }

  // ─── Bundle R$100 (slot purchase + entitlement) ─────────────────────────────
  static async createSlotPurchase(conn, { id_user_payer, amount_cents = 10000 }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_slot_purchase (id_user_payer, amount_cents)
         VALUES ($1, $2)
       RETURNING id_purchase, id_user_payer, amount_cents, status, created_at`,
      [id_user_payer, amount_cents]
    );
    return r.rows[0];
  }

  static async setSlotPurchaseSession(conn, id_purchase, session_id) {
    await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET stripe_session_id = $2
        WHERE id_purchase = $1`,
      [id_purchase, session_id]
    );
  }

  static async getSlotPurchaseBySession(conn, session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_slot_purchase
        WHERE stripe_session_id = $1
        LIMIT 1`,
      [session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Marca a compra como aplicada (idempotente: só se applied_at IS NULL).
  // Retorna o id_user se aplicou AGORA; null se já estava aplicada / inexistente.
  static async markSlotPurchaseApplied(conn, session_id, payment_intent_id) {
    const r = await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET status = 'paid', paid_at = NOW(), applied_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id)
        WHERE stripe_session_id = $1 AND applied_at IS NULL
        RETURNING id_user_payer`,
      [session_id, payment_intent_id]
    );
    return r.rowCount ? r.rows[0].id_user_payer : null;
  }

  // +1/+1 (capado em 3). Cria a linha em 2/2 se ainda não existir.
  static async incrementEntitlement(conn, id_user) {
    await conn.query(
      `INSERT INTO public.tb_community_entitlement (id_user, create_cap, member_cap)
         VALUES ($1, 2, 2)
       ON CONFLICT (id_user) DO UPDATE
         SET create_cap = LEAST(3, public.tb_community_entitlement.create_cap + 1),
             member_cap = LEAST(3, public.tb_community_entitlement.member_cap + 1),
             updated_at = NOW()`,
      [id_user]
    );
  }

  static async getAppliedPurchaseByPaymentIntent(conn, payment_intent_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_slot_purchase
        WHERE stripe_payment_intent_id = $1
          AND applied_at IS NOT NULL
          AND status = 'paid'
        LIMIT 1`,
      [payment_intent_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async markSlotPurchaseRefunded(conn, id_purchase) {
    await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET status = 'refunded'
        WHERE id_purchase = $1`,
      [id_purchase]
    );
  }

  // -1/-1 no reembolso, sem ir abaixo de 1 nem abaixo do que o user já usa
  // (não dá pra "des-criar" comunidades / des-participar à força).
  static async decrementEntitlement(conn, id_user) {
    await conn.query(
      `UPDATE public.tb_community_entitlement e
          SET create_cap = GREATEST(
                1,
                (SELECT COUNT(*) FROM public.tb_profile p
                  WHERE p.id_leader_user = $1 AND p.is_community = TRUE AND p.deleted_at IS NULL),
                e.create_cap - 1),
              member_cap = GREATEST(
                1,
                (SELECT COUNT(*) FROM public.tb_community_member m
                   JOIN public.tb_profile p ON p.id_profile = m.id_community_profile
                  WHERE m.id_user = $1 AND p.deleted_at IS NULL),
                e.member_cap - 1),
              updated_at = NOW()
        WHERE e.id_user = $1`,
      [id_user]
    );
  }

  static async markSlotPurchaseExpiredBySession(conn, session_id) {
    const r = await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET status = 'canceled'
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_purchase`,
      [session_id]
    );
    return r.rowCount > 0;
  }
}

module.exports = CommunityStorage;
