// src/storages/BeeFeedStorage.js
// Leitura da timeline de bees. Colunas espelham o que o front (BeeItem,
// FeedPost-like) precisa; joins de perfil/enxame/profissão copiam o padrão do
// StoryStorage + PortfolioFeedStorage (buildProfileUrl precisa de
// profession_slug/municipio/username/sub_profile_slug).
const { BEE_ALIVE_SQL } = require("./BeeEngagementStorage");

const BEE_SELECT = `
  s.id_story, s.id_profile, s.id_user, s.kind,
  s.video_url, s.thumbnail_url, s.duration_seconds, s.width, s.height,
  s.caption, s.metadata, s.location, s.links,
  s.audio_track_id, s.audio_start_ms,
  s.likes_count, s.comments_count, s.shares_count, s.impressions_count,
  s.engagement_score, s.created_at,
  LEAST(
    s.created_at + INTERVAL '7 days',
    s.created_at + INTERVAL '24 hours' + (s.engagement_score * INTERVAL '1 hour')
  ) AS effective_expires_at,
  s.created_at AS published_at,
  p.display_name, p.avatar_url, p.is_clan, p.sub_profile_slug,
  p.municipio, p.estado,
  u.username,
  c.id_category, c.desc_category AS profession_name, c.profession_slug,
  m.id_machine, m.slug AS machine_slug, m.name AS machine_name,
  m.color_from, m.color_to, m.color_glow, m.color_ring, m.color_accent, m.color_text,
  at.title AS audio_title, at.artist AS audio_artist,
  at.storage_key AS audio_storage_key, at.cover_key AS audio_cover_key,
  at.duration_ms AS audio_duration_ms
`;

const BEE_JOINS = `
  JOIN public.tb_profile p ON p.id_profile = s.id_profile
  JOIN public.tb_user u ON u.id_user = p.id_user
  LEFT JOIN public.tb_category c ON c.id_category = p.id_category
  LEFT JOIN public.tb_machine m ON m.id_machine = COALESCE(c.id_machine, p.id_machine)
  LEFT JOIN public.tb_audio_track at
    ON at.id_audio_track = s.audio_track_id AND at.is_active = TRUE
`;

// O viewer (quando presente) é SEMPRE o 1º parâmetro — o scopeClause de
// listCandidates referencia $1 de propósito.
function viewerColumns(params, viewer_id_user) {
  if (!viewer_id_user) {
    return `FALSE AS viewer_has_liked, FALSE AS viewer_has_bookmarked`;
  }
  params.push(viewer_id_user);
  const idx = params.length;
  return `
    EXISTS (SELECT 1 FROM public.tb_story_like sl
             WHERE sl.id_story = s.id_story AND sl.id_user = $${idx}) AS viewer_has_liked,
    EXISTS (SELECT 1 FROM public.tb_story_bookmark sb
             WHERE sb.id_story = s.id_story AND sb.id_user = $${idx}) AS viewer_has_bookmarked
  `;
}

class BeeFeedStorage {
  // Candidatos da timeline. order 'top' = por score (pool top do mix);
  // order 'new' = por data. scope 'following' filtra por tb_user_follow do
  // viewer (+ os próprios bees do viewer).
  static async listCandidates(conn, { viewer_id_user, scope, order, limit }) {
    const params = [];
    const viewerCols = viewerColumns(params, viewer_id_user);
    let scopeClause = "";
    if (scope === "following" && viewer_id_user) {
      scopeClause = `AND (
        s.id_profile IN (
          SELECT target_profile_id FROM public.tb_user_follow
           WHERE follower_user_id = $1 AND deleted_at IS NULL
        )
        OR s.id_user = $1
      )`;
    }
    params.push(limit);
    const orderClause = order === "new"
      ? `ORDER BY s.created_at DESC`
      : `ORDER BY s.engagement_score DESC, s.created_at DESC`;
    const { rows } = await conn.query(
      `SELECT ${BEE_SELECT}, ${viewerCols}
         FROM public.tb_story s
         ${BEE_JOINS}
        WHERE s.kind = 'bee'
          AND ${BEE_ALIVE_SQL}
          AND p.deleted_at IS NULL AND p.is_active = TRUE
          ${scopeClause}
        ${orderClause}
        LIMIT $${params.length}`,
      params
    );
    return rows;
  }

  static async getById(conn, { id_story, viewer_id_user }) {
    const params = [];
    const viewerCols = viewerColumns(params, viewer_id_user);
    params.push(id_story);
    const { rows } = await conn.query(
      `SELECT ${BEE_SELECT}, ${viewerCols}
         FROM public.tb_story s
         ${BEE_JOINS}
        WHERE s.id_story = $${params.length}
          AND s.kind = 'bee'
          AND ${BEE_ALIVE_SQL}
        LIMIT 1`,
      params
    );
    return rows[0] || null;
  }

  // Salvos: bookmarks do viewer cujo bee ainda está vivo (expirado some).
  static async listBookmarked(conn, { viewer_id_user, limit = 60 }) {
    const params = [];
    const viewerCols = viewerColumns(params, viewer_id_user);
    params.push(limit);
    const { rows } = await conn.query(
      `SELECT ${BEE_SELECT}, ${viewerCols}, sb.created_at AS bookmarked_at
         FROM public.tb_story_bookmark sb
         JOIN public.tb_story s ON s.id_story = sb.id_story
         ${BEE_JOINS}
        WHERE sb.id_user = $1
          AND s.kind = 'bee'
          AND ${BEE_ALIVE_SQL}
          AND p.deleted_at IS NULL AND p.is_active = TRUE
        ORDER BY sb.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return rows;
  }
}

module.exports = BeeFeedStorage;
