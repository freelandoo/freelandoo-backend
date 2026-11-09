// src/services/BeeFeedService.js
// Timeline dos bees: MESMA regra do feed de posts (utils/feedMix — 60/25/15,
// boost de novidade, penalidade) aplicada sobre tb_story kind='bee' vivos.
const pool = require("../databases");
const BeeFeedStorage = require("../storages/BeeFeedStorage");
const { canViewBee } = require("./communityInsideAccess");
const feedMix = require("../utils/feedMix");
const ReachStorage = require("../storages/ReachStorage");
const { reachLabel } = require("../utils/feedReach");
const { buildProfileUrl } = require("../utils/slug");
const { publicUrl: audioPublicUrl } = require("../integrations/r2/uploadAudioTrack");
const { assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BeeFeedService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 24;
const DEFAULT_LIMIT = 6;
const TOP_POOL_FETCH = 300;
const NEW_POOL_FETCH = 200;

// Shape do item da timeline — espelha o FeedPost onde faz sentido
// (post_id === id_story) pra reaproveitar BeesPost/CommentsPanel no front.
function shapeBee(row) {
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

  const profession_slug = row.profession_slug || (row.is_clan ? "clan" : null);
  const public_profile_url =
    profession_slug && row.username
      ? buildProfileUrl({
          profession_slug,
          municipio: row.municipio,
          handle: row.username,
          sub_profile_slug: row.sub_profile_slug,
        })
      : null;

  const media_type = row.metadata && row.metadata.media_type === "image" ? "image" : "video";

  return {
    id_story: row.id_story,
    post_id: row.id_story,
    profile_id: row.id_profile,
    profile_name: row.display_name,
    avatar_url: row.avatar_url,
    username: row.username,
    is_clan: row.is_clan,
    sub_profile_slug: row.sub_profile_slug,
    machine,
    city: row.municipio,
    state: row.estado,
    caption: row.caption,
    media_type,
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    location: row.location || null,
    links: Array.isArray(row.links) ? row.links : [],
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
    likes_count: Number(row.likes_count) || 0,
    comments_count: Number(row.comments_count) || 0,
    shares_count: Number(row.shares_count) || 0,
    impressions_count: Number(row.impressions_count) || 0,
    engagement_score: Number(row.engagement_score) || 0,
    created_at: row.created_at,
    published_at: row.published_at,
    effective_expires_at: row.effective_expires_at,
    viewer_has_liked: !!row.viewer_has_liked,
    viewer_has_bookmarked: !!row.viewer_has_bookmarked,
    viewer_has_disliked: !!row.viewer_has_disliked,
    // Patamar do alcance (0 cidade … 4 Brasil) = a COR do bee para todos (regra
    // do Alex 2026-11-08: a pessoa vê que está crescendo). Pontos nunca saem.
    reach_tier: Math.min(4, Math.max(0, Number(row.reach_level) || 0)),
    // Até onde o bee chegou, com o nome do lugar — só para o dono (mig 328).
    my_reach: row.viewer_is_owner && row.reach_level != null ? reachLabel(row) : null,
    public_profile_url,
  };
}

class BeeFeedService {
  static async getTimeline(user, query = {}) {
    return runWithLogs(log, "getTimeline",
      () => ({ id_user: user?.id_user, scope: query?.scope, cursor: query?.cursor || null }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        // Paridade com a página /bees antiga: gate do menor can_use_bees.
        const minorBlock = await assertMinorPermission(user.id_user, "can_use_bees");
        if (minorBlock) return minorBlock;

        const scope = query?.scope === "following" ? "following" : "global";
        const requested = Number(query?.limit);
        const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : DEFAULT_LIMIT, 1), MAX_LIMIT);

        const parsed = feedMix.parseCursor(query?.cursor);
        const seed = parsed.seed || feedMix.generateSeed();
        const startIndex = parsed.seed ? parsed.index : 0;

        const viewer_place = await ReachStorage.viewerPlace(pool, user.id_user);
        const [topRows, newRows] = await Promise.all([
          BeeFeedStorage.listCandidates(pool, {
            viewer_id_user: user.id_user, scope, order: "top", limit: TOP_POOL_FETCH, viewer_place,
          }),
          BeeFeedStorage.listCandidates(pool, {
            viewer_id_user: user.id_user, scope, order: "new", limit: NEW_POOL_FETCH, viewer_place,
          }),
        ]);

        // dedupeRows chaveia em post_id — anotar antes de deduplicar.
        const annotated = [...topRows, ...newRows].map((r) => ({ ...r, post_id: r.id_story }));
        const candidates = feedMix.dedupeRows(annotated);
        const rng = feedMix.makeRng(seed);
        const ordered = feedMix.orderByReachBands(candidates, rng);

        const slice = ordered.slice(startIndex, startIndex + limit);
        let nextSeed = seed;
        let nextIndex = startIndex + slice.length;
        // INFINITO como o feed (regra do Alex): acabou a volta, começa outra com
        // semente nova; a página curta do fim é completada sem repetir bee nela.
        if (ordered.length > 0 && nextIndex >= ordered.length) {
          nextSeed = feedMix.generateSeed();
          nextIndex = 0;
          if (slice.length < limit) {
            const seen = new Set(slice.map((r) => r.post_id));
            const again = feedMix.orderByReachBands(candidates, feedMix.makeRng(nextSeed));
            while (slice.length < limit && nextIndex < again.length) {
              const row = again[nextIndex++];
              if (!seen.has(row.post_id)) {
                seen.add(row.post_id);
                slice.push(row);
              }
            }
            if (nextIndex >= again.length) {
              nextSeed = feedMix.generateSeed();
              nextIndex = 0;
            }
          }
        }
        const items = slice.map(shapeBee);
        const has_more = ordered.length > 0;
        return { items, next_cursor: has_more ? `${nextSeed}:${nextIndex}` : null, has_more, scope };
      });
  }

  static async getOne(user, params) {
    return runWithLogs(log, "getOne",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story inválido", statusCode: 400 };
        }
        const row = await BeeFeedStorage.getById(pool, {
          id_story, viewer_id_user: user.id_user,
        });
        // Bee do mural de comunidade exclusiva: 404 para quem é de fora.
        if (!row || !(await canViewBee(row, user.id_user))) {
          return { error: "Bee não encontrado", statusCode: 404 };
        }
        return { item: shapeBee(row) };
      });
  }

  static async listBookmarked(user) {
    return runWithLogs(log, "listBookmarked",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const rows = await BeeFeedStorage.listBookmarked(pool, {
          viewer_id_user: user.id_user,
        });
        return { items: rows.map(shapeBee) };
      });
  }
}

module.exports = BeeFeedService;
