const PortfolioFeedStorage = require("../../storages/PortfolioFeedStorage");
const { assertMinorPermission } = require("../../utils/supervision");
const { createLogger, runWithLogs } = require("../../utils/logger");
const { slugify, buildProfileUrl } = require("../../utils/slug");
const { publicUrl: audioPublicUrl } = require("../../integrations/r2/uploadAudioTrack");
// Algoritmo do feed (60/25/15, boost de novidade, penalidade, PRNG com seed):
// extraído pra utils/feedMix.js e COMPARTILHADO com a timeline de bees
// (BeeFeedService). Ajustes de peso/boost valem pros dois consumidores.
const {
  generateSeed,
  parseCursor,
  hashSeed,
  makeRng,
  buildPools,
  interleave,
  dedupeRows,
  computeRankInfo,
} = require("../../utils/feedMix");

const log = createLogger("PortfolioFeedService");

const MAX_LIMIT = 24;
const DEFAULT_LIMIT = 12;
const WHATSAPP_BASE = "https://wa.me/";

// Pool sizing — limites de quantos candidatos puxamos do banco antes de mixar.
// Mantém custo previsível mesmo quando a base cresce.
const TOP_POOL_FETCH = 300;
const NEW_POOL_FETCH = 200;

// ──────────────────────────────────────────────────────────────────────────
// Shape do post para a API pública.
// ──────────────────────────────────────────────────────────────────────────
function shapeRow(row) {
  const machine = row.id_machine
    ? {
        id: row.id_machine,
        slug: row.machine_slug,
        name: row.machine_name,
        color_from: row.color_from,
        color_to: row.color_to,
        color_glow: row.color_glow,
        color_ring: row.color_ring,
        color_accent: row.color_accent,
        color_text: row.color_text,
      }
    : null;

  const profession = row.id_category
    ? {
        id: row.id_category,
        name: row.profession_name,
        slug: row.profession_slug,
      }
    : null;

  const profession_slug =
    row.profession_slug || (row.is_clan ? "clan" : null);
  const handle = row.username || "";
  const public_profile_url =
    profession_slug && handle
      ? buildProfileUrl({
          profession_slug,
          municipio: row.municipio,
          handle,
          sub_profile_slug: row.sub_profile_slug,
        })
      : null;

  const whatsapp_url = row.whatsapp_phone
    ? `${WHATSAPP_BASE}${row.whatsapp_phone}`
    : null;

  return {
    post_id: row.post_id,
    profile_id: row.id_profile,
    profile_name: row.display_name,
    avatar_url: row.avatar_url,
    username: row.username,
    is_clan: row.is_clan,
    sub_profile_slug: row.sub_profile_slug,
    machine,
    profession,
    city: row.municipio,
    state: row.estado,
    title: row.title,
    caption: row.description,
    project_url: row.project_url || null,
    source_type: row.source_type || "portfolio",
    source_course_id: row.source_course_id || null,
    media: row.media || [],
    // Música anexada (metadado, mig 108) — player toca; nada é queimado.
    audio: row.audio_track_id
      ? {
          id_audio_track: row.audio_track_id,
          start_ms: row.audio_start_ms || 0,
          title: row.audio_title || null,
          artist: row.audio_artist || null,
          audio_url: row.audio_storage_key ? audioPublicUrl(row.audio_storage_key) : null,
          cover_url: row.audio_cover_key ? audioPublicUrl(row.audio_cover_key) : null,
          duration_ms: row.audio_duration_ms || 0,
        }
      : null,
    likes_count: row.likes_count,
    shares_count: row.shares_count,
    impressions_count: row.impressions_count,
    profile_clicks_count: row.profile_clicks_count,
    whatsapp_clicks_count: row.whatsapp_clicks_count,
    social_clicks_count: row.social_clicks_count,
    comments_count: row.comments_count ?? 0,
    engagement_score: Number(row.engagement_score) || 0,
    published_at: row.published_at,
    feed_kind: row.feed_kind === "bees" ? "bees" : "feed",
    viewer_has_liked: !!row.viewer_has_liked,
    viewer_has_bookmarked: !!row.viewer_has_bookmarked,
    public_profile_url,
    whatsapp_url,
    social_links: row.social_links || [],
    // Comunidade à qual o post está ligado (mig 160) — alimenta o botão
    // "Acessar comunidade" no header do card do /feed. Null se não pertence.
    community: row.community_id
      ? {
          id_profile: row.community_id,
          display_name: row.community_name || null,
          avatar_url: row.community_avatar || null,
        }
      : null,
    // Academia à qual o post está ligado (mig 181) — alimenta o chip "Acessar
    // academia" no header do card do /feed. Null se não pertence.
    academy: row.academy_id
      ? {
          id_academy: row.academy_id,
          slug: row.academy_slug || null,
          nome: row.academy_name || null,
          avatar_url: row.academy_avatar || null,
        }
      : null,
  };
}

class PortfolioFeedService {
  static async getFeed({ db, filters, pagination, viewer }) {
    return runWithLogs(
      log,
      "getFeed",
      () => ({
        ...filters,
        cursor: pagination?.cursor || null,
        limit: pagination?.limit,
        viewer: viewer?.id_user ? "auth" : "anon",
      }),
      async () => {
        // Supervisão: bloqueia visualização do feed/bees para menor sem toggle.
        if (viewer?.id_user) {
          const wantsBees = filters?.feed_kind === "bees";
          const permKey = wantsBees ? "can_use_bees" : "can_view_feed";
          const minorBlock = await assertMinorPermission(viewer.id_user, permKey);
          if (minorBlock) return minorBlock;
        }

        const requestedLimit = Number.isFinite(pagination?.limit)
          ? pagination.limit
          : DEFAULT_LIMIT;
        const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

        const parsed = parseCursor(pagination?.cursor);
        const seed = parsed.seed || generateSeed();
        const startIndex = parsed.seed ? parsed.index : 0;

        const params = {
          id_machine: filters?.id_machine,
          id_category: filters?.id_category,
          estado: filters?.estado,
          id_region: filters?.id_region,
          level_min: filters?.level_min,
          exclude_ids: filters?.exclude_ids,
          // null = misto (feed + bees); 'feed' ou 'bees' filtra um tipo só.
          feed_kind:
            filters?.feed_kind === "feed" || filters?.feed_kind === "bees"
              ? filters.feed_kind
              : null,
          country: filters?.country || null,
          viewer_id_user: viewer?.id_user || null,
        };

        const [topRows, newRows] = await Promise.all([
          PortfolioFeedStorage.listTopCandidates(db, {
            ...params,
            limit: TOP_POOL_FETCH,
          }),
          PortfolioFeedStorage.listNewCandidates(db, {
            ...params,
            limit: NEW_POOL_FETCH,
          }),
        ]);

        const candidates = dedupeRows([...topRows, ...newRows]);
        const rng = makeRng(seed);
        const pools = buildPools(candidates, rng);
        const ordered = interleave(pools);

        const slice = ordered.slice(startIndex, startIndex + limit);
        const items = slice.map(shapeRow);
        const nextIndex = startIndex + slice.length;
        const has_more = nextIndex < ordered.length;
        const next_cursor = has_more ? `${seed}:${nextIndex}` : null;

        return { items, next_cursor, has_more };
      }
    );
  }
}

module.exports = PortfolioFeedService;
module.exports.slugify = slugify;
// Reutilizado pelo feed da comunidade (CommunityStorage/Service) para produzir
// o MESMO shape FeedPost que o card do /feed consome.
module.exports.shapeRow = shapeRow;
module.exports._internal = {
  parseCursor,
  generateSeed,
  hashSeed,
  makeRng,
  buildPools,
  interleave,
  computeRankInfo,
};
