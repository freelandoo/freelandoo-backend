// src/storages/EngagementStorage.js
//
// Agregações read-only para o painel "Engajamento" da página /account/xp.
// Tudo sobre tabelas existentes — sem migration. Escopo pode ser a conta
// inteira (todos os perfis do user) ou um perfil/clan específico.
//
// Sinais:
//  - Views por canal: tb_story_view (trampo/rest) + tb_portfolio_event impression
//    (bees/feed via feed_kind do item).
//  - Interações: portfolio_likes, tb_portfolio_comment, tb_portfolio_event
//    (share/whatsapp_click/profile_click/social_click), profile_ratings, follows.
//  - Seguidores: tb_user_follow (target = perfil). Seguindo: nível-conta (follower).
//  - Região/Enxame/Horários: contexto de quem VÊ (filtros do tb_portfolio_event).
//  - Top conteúdo: itens de portfólio (engagement_score) + stories (views).
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("EngagementStorage");

const TZ = "America/Sao_Paulo";

module.exports = {
  // Resolve os perfis do escopo + valida ownership.
  // Retorna { profile_ids, error? }. Para account: todos os perfis ativos do user.
  async resolveScope(db, { id_user, scope, id_profile }) {
    if (scope === "profile") {
      if (!id_profile) return { error: "id_profile obrigatório" };
      const r = await db.query(
        `SELECT id_profile
           FROM tb_profile
          WHERE id_profile = $1 AND id_user = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [id_profile, id_user]
      );
      if (!r.rows.length) return { error: "Perfil não encontrado" };
      return { profile_ids: [id_profile] };
    }
    // account
    const r = await db.query(
      `SELECT id_profile
         FROM tb_profile
        WHERE id_user = $1 AND deleted_at IS NULL`,
      [id_user]
    );
    return { profile_ids: r.rows.map((row) => row.id_profile) };
  },

  // Payload completo do painel. Usa UMA conexão do pool e roda as queries
  // sequencialmente — analytics privado, não vale estourar o pool com ~20
  // conexões simultâneas por request.
  async getEngagement(db, { id_user, profile_ids, since }) {
    return runWithLogs(
      log,
      "getEngagement",
      () => ({ id_user, profiles: profile_ids.length, since }),
      async () => {
        const ids = profile_ids;
        const noData = ids.length === 0;

        const conn = await db.connect();
        try {
          const views = noData ? this._emptyViews() : await this._views(conn, ids, since);
          const interactions = noData ? this._emptyInteractions() : await this._interactions(conn, ids, since);
          const followers = noData ? { total: 0, new_in_range: 0 } : await this._followers(conn, ids, since);
          const following = await this._following(conn, id_user);
          const byRegion = noData ? [] : await this._byRegion(conn, ids, since);
          const byEnxame = noData ? [] : await this._byEnxame(conn, ids, since);
          const activeHours = noData ? this._zeroHours() : await this._activeHours(conn, ids, since);
          const topContent = noData ? [] : await this._topContent(conn, ids, since);

          return {
            views,
            interactions,
            followers,
            following,
            by_region: byRegion,
            by_enxame: byEnxame,
            active_hours: activeHours,
            top_content: topContent,
          };
        } finally {
          conn.release();
        }
      }
    );
  },

  // ── VIEWS ──────────────────────────────────────────────────────────────────
  async _views(db, ids, since) {
    // Stories: views agrupadas por canal (trampo/rest).
    const story = await db.query(
      `SELECT s.kind, COUNT(*)::int AS cnt
         FROM tb_story_view v
         JOIN tb_story s ON s.id_story = v.id_story
        WHERE s.id_profile = ANY($1::uuid[])
          AND v.viewed_at >= $2
        GROUP BY s.kind`,
      [ids, since]
    );

    // Bees/Feed: impressões agrupadas pelo feed_kind do item.
    const impr = await db.query(
      `SELECT i.feed_kind, COUNT(*)::int AS cnt
         FROM tb_portfolio_event e
         JOIN tb_profile_portfolio_item i ON i.id_portfolio_item = e.id_portfolio_item
        WHERE e.id_profile = ANY($1::uuid[])
          AND e.event_type = 'impression'
          AND e.created_at >= $2
        GROUP BY i.feed_kind`,
      [ids, since]
    );

    // Visitas ao perfil (cliques no nome/avatar a partir do feed).
    const visits = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM tb_portfolio_event e
        WHERE e.id_profile = ANY($1::uuid[])
          AND e.event_type = 'profile_click'
          AND e.created_at >= $2`,
      [ids, since]
    );

    // Tempo assistido (retenção) na janela.
    const ret = await db.query(
      `SELECT COALESCE(SUM(seconds_watched), 0)::bigint AS secs
         FROM portfolio_content_retention
        WHERE id_profile = ANY($1::uuid[])
          AND created_at >= $2`,
      [ids, since]
    );

    const by_channel = { story_trampo: 0, story_rest: 0, bees: 0, feed: 0 };
    for (const row of story.rows) {
      if (row.kind === "trampo") by_channel.story_trampo = Number(row.cnt);
      // Bees v2: 'bee' soma no canal story_rest (o rest legado morre em 24h;
      // o label visível vira "Bees" no front — chave mantida por compat).
      else if (row.kind === "rest" || row.kind === "bee") {
        by_channel.story_rest += Number(row.cnt);
      }
    }
    for (const row of impr.rows) {
      if (row.feed_kind === "bees") by_channel.bees = Number(row.cnt);
      else if (row.feed_kind === "feed") by_channel.feed = Number(row.cnt);
    }

    const total =
      by_channel.story_trampo +
      by_channel.story_rest +
      by_channel.bees +
      by_channel.feed;

    return {
      total,
      by_channel,
      profile_visits: Number(visits.rows[0]?.cnt || 0),
      retention_seconds: Number(ret.rows[0]?.secs || 0),
    };
  },

  _emptyViews() {
    return {
      total: 0,
      by_channel: { story_trampo: 0, story_rest: 0, bees: 0, feed: 0 },
      profile_visits: 0,
      retention_seconds: 0,
    };
  },

  // ── INTERACTIONS ─────────────────────────────────────────────────────────
  async _interactions(db, ids, since) {
    const likes = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM portfolio_likes
        WHERE id_profile = ANY($1::uuid[]) AND liked_at >= $2`,
      [ids, since]
    );
    const comments = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM tb_portfolio_comment c
         JOIN tb_profile_portfolio_item i ON i.id_portfolio_item = c.id_portfolio_item
        WHERE i.id_profile = ANY($1::uuid[])
          AND c.is_active = TRUE
          AND c.created_at >= $2`,
      [ids, since]
    );
    // share / whatsapp_click / profile_click / social_click num único scan.
    const events = await db.query(
      `SELECT event_type, COUNT(*)::int AS cnt
         FROM tb_portfolio_event
        WHERE id_profile = ANY($1::uuid[])
          AND created_at >= $2
          AND event_type IN ('share','whatsapp_click','profile_click','social_click')
        GROUP BY event_type`,
      [ids, since]
    );
    const reviews = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM profile_ratings
        WHERE id_profile = ANY($1::uuid[]) AND rated_at >= $2`,
      [ids, since]
    );
    const newFollowers = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM tb_user_follow
        WHERE target_profile_id = ANY($1::uuid[])
          AND deleted_at IS NULL
          AND created_at >= $2`,
      [ids, since]
    );

    const ev = { share: 0, whatsapp_click: 0, profile_click: 0, social_click: 0 };
    for (const row of events.rows) ev[row.event_type] = Number(row.cnt);

    const likesN = Number(likes.rows[0]?.cnt || 0);
    const commentsN = Number(comments.rows[0]?.cnt || 0);
    const reviewsN = Number(reviews.rows[0]?.cnt || 0);
    const newFollowersN = Number(newFollowers.rows[0]?.cnt || 0);

    const total =
      likesN +
      commentsN +
      ev.share +
      ev.whatsapp_click +
      ev.profile_click +
      ev.social_click +
      reviewsN +
      newFollowersN;

    return {
      total,
      likes: likesN,
      comments: commentsN,
      shares: ev.share,
      whatsapp_clicks: ev.whatsapp_click,
      profile_clicks: ev.profile_click,
      social_clicks: ev.social_click,
      reviews: reviewsN,
      new_followers: newFollowersN,
    };
  },

  _emptyInteractions() {
    return {
      total: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      whatsapp_clicks: 0,
      profile_clicks: 0,
      social_clicks: 0,
      reviews: 0,
      new_followers: 0,
    };
  },

  // ── FOLLOWERS (acompanham) ───────────────────────────────────────────────
  async _followers(db, ids, since) {
    const r = await db.query(
      `SELECT
         COUNT(DISTINCT follower_user_id)::int AS total,
         COUNT(DISTINCT follower_user_id)
           FILTER (WHERE created_at >= $2)::int AS new_in_range
         FROM tb_user_follow
        WHERE target_profile_id = ANY($1::uuid[])
          AND deleted_at IS NULL`,
      [ids, since]
    );
    return {
      total: Number(r.rows[0]?.total || 0),
      new_in_range: Number(r.rows[0]?.new_in_range || 0),
    };
  },

  // ── FOLLOWING (acompanhados) — nível-conta ───────────────────────────────
  async _following(db, id_user) {
    const r = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM tb_user_follow
        WHERE follower_user_id = $1 AND deleted_at IS NULL`,
      [id_user]
    );
    return { total: Number(r.rows[0]?.total || 0) };
  },

  // ── POR REGIÃO (UF de quem vê) ───────────────────────────────────────────
  async _byRegion(db, ids, since) {
    const r = await db.query(
      `SELECT state_filter AS uf, COUNT(*)::int AS cnt
         FROM tb_portfolio_event
        WHERE id_profile = ANY($1::uuid[])
          AND created_at >= $2
          AND event_type = 'impression'
          AND state_filter IS NOT NULL
        GROUP BY state_filter
        ORDER BY cnt DESC
        LIMIT 8`,
      [ids, since]
    );
    return r.rows.map((row) => ({ uf: row.uf, count: Number(row.cnt) }));
  },

  // ── POR ENXAME (filtro de máquina de quem vê) ────────────────────────────
  async _byEnxame(db, ids, since) {
    const r = await db.query(
      `SELECT e.machine_filter AS id_machine,
              m.name           AS name,
              m.color_ring     AS color_ring,
              COUNT(*)::int    AS cnt
         FROM tb_portfolio_event e
         JOIN tb_machine m ON m.id_machine = e.machine_filter
        WHERE e.id_profile = ANY($1::uuid[])
          AND e.created_at >= $2
          AND e.event_type = 'impression'
          AND e.machine_filter IS NOT NULL
        GROUP BY e.machine_filter, m.name, m.color_ring
        ORDER BY cnt DESC
        LIMIT 8`,
      [ids, since]
    );
    return r.rows.map((row) => ({
      id_machine: row.id_machine,
      name: row.name,
      color_ring: row.color_ring,
      count: Number(row.cnt),
    }));
  },

  // ── HORÁRIOS ATIVOS (0..23, fuso BR) ─────────────────────────────────────
  async _activeHours(db, ids, since) {
    const r = await db.query(
      `SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE $3))::int AS hour,
              COUNT(*)::int AS cnt
         FROM tb_portfolio_event
        WHERE id_profile = ANY($1::uuid[])
          AND created_at >= $2
          AND event_type = 'impression'
        GROUP BY 1`,
      [ids, since, TZ]
    );
    const buckets = this._zeroHours();
    for (const row of r.rows) {
      const h = Number(row.hour);
      if (h >= 0 && h <= 23) buckets[h].count = Number(row.cnt);
    }
    return buckets;
  },

  _zeroHours() {
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  },

  // ── TOP CONTEÚDO ─────────────────────────────────────────────────────────
  // União de itens de portfólio (feed/bees) por engagement_score + stories ativas
  // por contagem de views. Pega os 6 mais fortes.
  async _topContent(db, ids, since) {
    const items = await db.query(
      `SELECT
         i.id_portfolio_item                AS id,
         i.feed_kind                        AS kind,
         i.title                            AS caption,
         i.likes_count                      AS likes,
         i.impressions_count                AS views,
         i.engagement_score                 AS score,
         i.published_at                     AS created_at,
         (SELECT media.thumbnail_url
            FROM tb_profile_portfolio_media media
           WHERE media.id_portfolio_item = i.id_portfolio_item
             AND media.is_active = TRUE
           ORDER BY media.sort_order ASC
           LIMIT 1)                         AS thumb_url,
         (SELECT media.media_url
            FROM tb_profile_portfolio_media media
           WHERE media.id_portfolio_item = i.id_portfolio_item
             AND media.is_active = TRUE
           ORDER BY media.sort_order ASC
           LIMIT 1)                         AS media_url
         FROM tb_profile_portfolio_item i
        WHERE i.id_profile = ANY($1::uuid[])
          AND i.is_active = TRUE
          AND i.status = 'published'
        ORDER BY i.engagement_score DESC, i.published_at DESC
        LIMIT 6`,
      [ids]
    );

    const stories = await db.query(
      `SELECT
         s.id_story         AS id,
         'story'::text      AS kind,
         s.kind             AS story_kind,
         s.caption          AS caption,
         s.thumbnail_url    AS thumb_url,
         s.video_url        AS media_url,
         s.created_at       AS created_at,
         COUNT(v.id_viewer_user)::int AS views
         FROM tb_story s
         LEFT JOIN tb_story_view v ON v.id_story = s.id_story
        WHERE s.id_profile = ANY($1::uuid[])
          AND s.deleted_at IS NULL
          AND s.created_at >= $2
        GROUP BY s.id_story
        ORDER BY views DESC, s.created_at DESC
        LIMIT 6`,
      [ids, since]
    );

    const merged = [
      ...items.rows.map((r) => ({
        kind: r.kind, // 'feed' | 'bees'
        id: r.id,
        thumb_url: r.thumb_url || r.media_url || null,
        caption: r.caption || null,
        views: Number(r.views || 0),
        likes: Number(r.likes || 0),
        score: Number(r.score || 0),
        created_at: r.created_at,
      })),
      ...stories.rows.map((r) => ({
        kind: r.story_kind === "trampo" ? "story_trampo" : "story_rest",
        id: r.id,
        thumb_url: r.thumb_url || r.media_url || null,
        caption: r.caption || null,
        views: Number(r.views || 0),
        likes: 0,
        score: Number(r.views || 0),
        created_at: r.created_at,
      })),
    ];

    merged.sort((a, b) => b.score - a.score || b.views - a.views);
    return merged.slice(0, 6);
  },
};
