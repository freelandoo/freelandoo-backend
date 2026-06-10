const pool = require("../databases");
const StoryStorage = require("../storages/StoryStorage");
const AudioTrackStorage = require("../storages/AudioTrackStorage");
const uploadStoryVideoToR2 = require("../integrations/r2/uploadStoryVideo");
const presignStory = require("../integrations/r2/presignStoryUpload");
const { publicUrl: audioPublicUrl } = require("../integrations/r2/uploadAudioTrack");
const ChatModerationService = require("./ChatModerationService");
const ConversationService = require("./ConversationService");
const { processPortfolioMedia, splitVideoIntoChunks } = require("../utils/mediaJobs");
const { assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoryService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KINDS = new Set(["trampo", "rest"]);

// Câmera (presigned/GPU-local): limites do arquivo final gerado no browser.
const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // 80MB (espelha uploadStoryVideo legado)
const MAX_POSTER_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — story de foto (WebP gerado no browser)
const VIDEO_CONTENT_TYPE = "video/mp4"; // SEMPRE MP4/H.264 (WebM não toca no iOS)
const IMAGE_CONTENT_TYPE = "image/webp"; // story de foto: WebP queimado no cliente
const POSTER_CONTENT_TYPE = "image/webp";
const DEFAULT_IMAGE_DURATION = 7; // segundos que a foto fica na tela
const FILTER_META_MAX_CHARS = 4000;

// Sanitiza o filterMeta vindo do cliente: aceita só objeto plano pequeno
// (preset/ajustes numéricos). Nunca contém dado facial — é só a "receita" visual.
function normalizeFilterMeta(value) {
  if (value === null || value === undefined) return null;
  let obj = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || Array.isArray(obj)) return null;
  let serialized;
  try {
    serialized = JSON.stringify(obj);
  } catch {
    return null;
  }
  if (!serialized || serialized.length > FILTER_META_MAX_CHARS) return null;
  return obj;
}

function normalizeKind(value) {
  if (typeof value !== "string") return null;
  const k = value.trim().toLowerCase();
  return KINDS.has(k) ? k : null;
}

function normalizeDuration(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const intN = Math.round(n);
  if (intN <= 0 || intN > 60) return null;
  return intN;
}

function normalizeOptionalInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

function normalizeAudioStartMs(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Cap em 1h — proteção contra valores absurdos.
  return Math.min(Math.round(n), 3_600_000);
}

// Confirma que a faixa escolhida existe e está ativa. Faixa inexistente/inativa
// → ignora silenciosamente (música é opcional; nunca derruba a publicação).
async function resolveAudioTrackId(value) {
  if (typeof value !== "string" || !UUID_RE.test(value)) return null;
  const track = await AudioTrackStorage.getById(pool, value);
  if (!track || track.is_active === false) return null;
  return track.id_audio_track;
}

function normalizeCaption(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 280);
}

function mapStory(row) {
  if (!row) return null;
  return {
    id_story: row.id_story,
    id_profile: row.id_profile,
    id_user: row.id_user,
    kind: row.kind,
    media_type: row.metadata && row.metadata.media_type === "image" ? "image" : "video",
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    caption: row.caption,
    created_at: row.created_at,
    expires_at: row.expires_at,
    // Música anexada (metadado) — só presente quando houve JOIN com tb_audio_track.
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
    profile: row.profile_display_name
      ? {
          id_profile: row.id_profile,
          display_name: row.profile_display_name,
          avatar_url: row.profile_avatar_url,
          is_clan: row.profile_is_clan,
          machine_name: row.machine_name,
          machine_slug: row.machine_slug,
        }
      : undefined,
  };
}

function mapFeedEntry(row) {
  return {
    id_profile: row.id_profile,
    is_self: !!row.is_self,
    has_unviewed: !!row.has_unviewed,
    active_count: Number(row.active_count) || 0,
    last_posted_at: row.last_posted_at,
    profile: {
      id_profile: row.id_profile,
      id_user: row.profile_user_id,
      display_name: row.profile_display_name,
      avatar_url: row.profile_avatar_url,
      is_clan: row.profile_is_clan,
      username: row.profile_username,
      sub_profile_slug: row.profile_slug,
    },
    machine: row.machine_slug
      ? {
          name: row.machine_name,
          slug: row.machine_slug,
          color_from: row.machine_color_from,
          color_to: row.machine_color_to,
          color_ring: row.machine_color_ring,
          color_accent: row.machine_color_accent,
        }
      : null,
  };
}

class StoryService {
  static async createStory(user, { id_profile }, body, file) {
    return runWithLogs(
      log,
      "createStory",
      () => ({
        id_user: user?.id_user,
        id_profile,
        kind: body?.kind,
        hasFile: !!file,
      }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        // Supervisão: stories são posts no feed/bees — respeita can_post_feed.
        const minorBlock = await assertMinorPermission(user.id_user, "can_post_feed");
        if (minorBlock) return minorBlock;
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile inválido" };
        }
        if (!file) return { error: "Arquivo não enviado" };

        const kind = normalizeKind(body?.kind);
        if (!kind) return { error: "kind inválido (use 'trampo' ou 'rest')" };

        const autoSplit = body?.auto_split === true || body?.auto_split === "true" || body?.auto_split === "1";
        const duration_seconds = normalizeDuration(body?.duration_seconds);
        if (!autoSplit && !duration_seconds) {
          return {
            error:
              "duration_seconds inválido — informe a duração em segundos (1..60)",
          };
        }

        const width = normalizeOptionalInt(body?.width);
        const height = normalizeOptionalInt(body?.height);
        const caption = normalizeCaption(body?.caption);
        const audioTrackId = await resolveAudioTrackId(body?.audio_track_id);
        const audioStartMs = audioTrackId ? normalizeAudioStartMs(body?.audio_start_ms) : 0;
        if (caption) {
          const moderation = await ChatModerationService.moderateMessage({
            id_user: user.id_user,
            room_type: "global",
            original_text: caption,
          });
          if (["block", "mute_temp", "review"].includes(moderation?.action)) {
            return {
              error:
                moderation.user_facing_error ||
                "Conteudo bloqueado por violar as politicas da plataforma.",
              moderation_action: moderation.action,
              moderation_flags: moderation.flags || [],
            };
          }
        }

        // ─── Pré-checagem de permissões (uma vez, fora da tx por chunk) ─────
        const profile = await StoryStorage.getProfileForOwnership(pool, {
          id_profile,
          id_user: user.id_user,
        });
        if (!profile) return { error: "Sem permissão para postar por este perfil" };
        if (!profile.is_active) return { error: "Perfil inativo não pode postar story" };
        if (kind === "trampo") {
          if (profile.is_clan) return { error: "Clans não podem postar trampo" };
          const subscribed = await StoryStorage.profileHasActiveSubscription(pool, id_profile);
          if (!subscribed) return { error: "Trampo é exclusivo de subperfis com assinatura ativa" };
        }

        // ─── Split (no-op se duração ≤ 60s) ─────────────────────────────────
        let chunks;
        try {
          chunks = autoSplit
            ? await splitVideoIntoChunks(file, 60)
            : [{ buffer: file.buffer, index: 0, duration: duration_seconds, originalname: file.originalname }];
        } catch (err) {
          return { error: err?.message || "Falha ao analisar vídeo" };
        }

        const total = chunks.length;
        const stories = [];
        for (const chunk of chunks) {
          const chunkFile = {
            ...file,
            buffer: chunk.buffer,
            originalname: chunk.originalname,
            size: chunk.buffer.length,
          };
          let processedFile;
          try {
            processedFile = await processPortfolioMedia(chunkFile, "video");
          } catch (err) {
            return { error: err?.message || "Falha ao processar vídeo" };
          }
          const uploaded = await uploadStoryVideoToR2({ id_profile, file: processedFile });
          const finalWidth = width || processedFile.mediaMetadata?.width || null;
          const finalHeight = height || processedFile.mediaMetadata?.height || null;
          const chunkCaption =
            total > 1
              ? (caption ? `${caption} (Parte ${chunk.index + 1}/${total})` : `Parte ${chunk.index + 1}/${total}`)
              : caption;
          const chunkDuration = Math.max(1, Math.min(60, Math.round(chunk.duration)));

          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const story = await StoryStorage.insertStory(client, {
              id_profile,
              id_user: user.id_user,
              kind,
              video_url: uploaded.url,
              thumbnail_url: uploaded.thumbnail_url,
              storage_key: uploaded.key,
              thumbnail_key: uploaded.thumbnail_key,
              duration_seconds: chunkDuration,
              width: finalWidth,
              height: finalHeight,
              caption: chunkCaption,
              metadata: {
                ...(processedFile.mediaMetadata || {}),
                storage_key: uploaded.key,
                ...(uploaded.thumbnail_key ? { thumbnail_storage_key: uploaded.thumbnail_key } : {}),
                ...(total > 1 ? { split_index: chunk.index, split_total: total } : {}),
              },
              audio_track_id: audioTrackId,
              audio_start_ms: audioStartMs,
            });
            await client.query("COMMIT");
            stories.push(mapStory(story));
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        }

        return { stories, story: stories[0] || null, count: stories.length };
      }
    );
  }

  // Pré-checagem compartilhada de permissão de postar story por um perfil.
  // Retorna { error } ou { profile } (perfil já validado p/ ownership/subscription).
  static async _assertCanPost(user, id_profile, kind) {
    if (!user?.id_user) return { error: "Usuário não autenticado" };
    const minorBlock = await assertMinorPermission(user.id_user, "can_post_feed");
    if (minorBlock) return minorBlock;
    if (!id_profile || !UUID_RE.test(id_profile)) {
      return { error: "id_profile inválido" };
    }
    if (!kind) return { error: "kind inválido (use 'trampo' ou 'rest')" };
    const profile = await StoryStorage.getProfileForOwnership(pool, {
      id_profile,
      id_user: user.id_user,
    });
    if (!profile) return { error: "Sem permissão para postar por este perfil" };
    if (!profile.is_active) return { error: "Perfil inativo não pode postar story" };
    if (kind === "trampo") {
      if (profile.is_clan) return { error: "Clans não podem postar trampo" };
      const subscribed = await StoryStorage.profileHasActiveSubscription(pool, id_profile);
      if (!subscribed) return { error: "Trampo é exclusivo de subperfis com assinatura ativa" };
    }
    return { profile };
  }

  // ─── Câmera: passo 1 — emite presigned PUT URLs (vídeo + poster) ───────────
  // O cliente grava/encoda local (WebCodecs) e sobe DIRETO pro R2 nessas URLs.
  // O servidor não recebe bytes de vídeo; só assina keys sob stories/<id_profile>/.
  static async createUploadUrls(user, body = {}) {
    return runWithLogs(
      log,
      "createUploadUrls",
      () => ({ id_user: user?.id_user, id_profile: body?.id_profile, kind: body?.kind }),
      async () => {
        const id_profile = body?.id_profile;
        const kind = normalizeKind(body?.kind);
        const check = await StoryService._assertCanPost(user, id_profile, kind);
        if (check.error) return check;

        const isImage = body?.media_type === "image";
        // Para foto, o "video" slot carrega o WebP (a própria imagem). O poster
        // continua sendo um WebP (no caso de foto, é a mesma imagem reduzida).
        const mainExt = isImage ? "webp" : "mp4";
        const mainType = isImage ? IMAGE_CONTENT_TYPE : VIDEO_CONTENT_TYPE;
        const mainMax = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;

        const videoKey = presignStory.buildKey(id_profile, kind, mainExt);
        const posterKey = presignStory.buildKey(id_profile, kind, "webp", "poster");
        const [videoUrl, posterUrl] = await Promise.all([
          presignStory.presignPut(videoKey, mainType),
          presignStory.presignPut(posterKey, POSTER_CONTENT_TYPE),
        ]);

        return {
          expires_in: presignStory.DEFAULT_EXPIRES,
          media_type: isImage ? "image" : "video",
          video: { key: videoKey, url: videoUrl, content_type: mainType, max_bytes: mainMax },
          poster: { key: posterKey, url: posterUrl, content_type: POSTER_CONTENT_TYPE, max_bytes: MAX_POSTER_BYTES },
        };
      }
    );
  }

  // ─── Câmera: passo 2 — cria a story a partir do que já foi enviado pro R2 ───
  // Valida ownership/subscription/moderação, confirma o objeto via HeadObject
  // (existe? tamanho ok? key no namespace certo?) e grava metadados (+ filterMeta).
  static async createStoryFromUpload(user, body = {}) {
    return runWithLogs(
      log,
      "createStoryFromUpload",
      () => ({ id_user: user?.id_user, id_profile: body?.id_profile, kind: body?.kind }),
      async () => {
        const id_profile = body?.id_profile;
        const kind = normalizeKind(body?.kind);
        const check = await StoryService._assertCanPost(user, id_profile, kind);
        if (check.error) return check;

        const isImage = body?.media_type === "image";
        // Foto não tem duração própria — usa um tempo padrão de exibição.
        const duration_seconds = isImage
          ? DEFAULT_IMAGE_DURATION
          : normalizeDuration(body?.duration_seconds);
        if (!duration_seconds) {
          return { error: "duration_seconds inválido — informe a duração em segundos (1..60)" };
        }
        const width = normalizeOptionalInt(body?.width);
        const height = normalizeOptionalInt(body?.height);
        const caption = normalizeCaption(body?.caption);
        const filterMeta = normalizeFilterMeta(body?.filter_meta);
        const renderMeta = normalizeFilterMeta(body?.render_meta);
        const audioTrackId = await resolveAudioTrackId(body?.audio_track_id);
        const audioStartMs = audioTrackId ? normalizeAudioStartMs(body?.audio_start_ms) : 0;

        const storageKey = body?.storage_key;
        const thumbnailKey = body?.thumbnail_key || null;
        const mainExt = isImage ? ".webp" : ".mp4";
        const mainMaxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
        if (!presignStory.keyBelongsToProfile(storageKey, id_profile) || !storageKey.endsWith(mainExt)) {
          return { error: "storage_key inválido" };
        }
        if (thumbnailKey && !presignStory.keyBelongsToProfile(thumbnailKey, id_profile)) {
          return { error: "thumbnail_key inválido" };
        }

        if (caption) {
          const moderation = await ChatModerationService.moderateMessage({
            id_user: user.id_user,
            room_type: "global",
            original_text: caption,
          });
          if (["block", "mute_temp", "review"].includes(moderation?.action)) {
            // Conteúdo do caption barrado → remove o objeto recém-enviado p/ não virar órfão.
            await presignStory.deleteObject(storageKey);
            if (thumbnailKey) await presignStory.deleteObject(thumbnailKey);
            return {
              error:
                moderation.user_facing_error ||
                "Conteudo bloqueado por violar as politicas da plataforma.",
              moderation_action: moderation.action,
              moderation_flags: moderation.flags || [],
            };
          }
        }

        // Confirma que a mídia realmente chegou no R2 e respeita os limites.
        const videoHead = await presignStory.headObject(storageKey);
        if (!videoHead.exists) {
          return {
            error: isImage
              ? "Upload da imagem não encontrado no storage. Tente novamente."
              : "Upload do vídeo não encontrado no storage. Tente novamente.",
          };
        }
        if (videoHead.size > mainMaxBytes) {
          await presignStory.deleteObject(storageKey);
          if (thumbnailKey) await presignStory.deleteObject(thumbnailKey);
          return { error: isImage ? "A imagem excede o limite de 8MB." : "O vídeo excede o limite de 80MB." };
        }

        let thumbnailUrl = null;
        let validThumbKey = null;
        if (thumbnailKey) {
          const posterHead = await presignStory.headObject(thumbnailKey);
          if (posterHead.exists && posterHead.size <= MAX_POSTER_BYTES) {
            thumbnailUrl = presignStory.publicUrl(thumbnailKey);
            validThumbKey = thumbnailKey;
          } else if (posterHead.exists) {
            await presignStory.deleteObject(thumbnailKey);
          }
        }

        const videoUrl = presignStory.publicUrl(storageKey);
        const metadata = {
          media_type: isImage ? "image" : "video",
          source: "camera",
          storage_key: storageKey,
          ...(validThumbKey ? { thumbnail_storage_key: validThumbKey } : {}),
          ...(filterMeta ? { filter_meta: filterMeta } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
        };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const story = await StoryStorage.insertStory(client, {
            id_profile,
            id_user: user.id_user,
            kind,
            video_url: videoUrl,
            thumbnail_url: thumbnailUrl,
            storage_key: storageKey,
            thumbnail_key: validThumbKey,
            duration_seconds,
            width,
            height,
            caption,
            metadata,
            audio_track_id: audioTrackId,
            audio_start_ms: audioStartMs,
            render_meta: renderMeta,
          });
          await client.query("COMMIT");
          return { story: mapStory(story) };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async listMine(user, query = {}) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user, kind: query?.kind }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const kind = normalizeKind(query?.kind);
        const items = await StoryStorage.listActiveByUser(pool, {
          id_user: user.id_user,
          kind,
        });
        return { items: items.map(mapStory).filter(Boolean) };
      }
    );
  }

  static async getFeed(user, query = {}) {
    return runWithLogs(
      log,
      "getFeed",
      () => ({ id_user: user?.id_user, kind: query?.kind }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const kind = normalizeKind(query?.kind);
        if (!kind) return { error: "kind inválido (use 'trampo' ou 'rest')" };

        const rows = await StoryStorage.listFeedForUser(pool, {
          viewer_user_id: user.id_user,
          kind,
        });
        return { items: rows.map(mapFeedEntry) };
      }
    );
  }

  static async getByProfile(user, params) {
    return runWithLogs(
      log,
      "getByProfile",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_profile = params?.id_profile;
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile inválido" };
        }

        const rows = await StoryStorage.listActiveByProfile(pool, {
          id_profile,
        });
        if (rows.length === 0) {
          return { items: [], viewed_ids: [] };
        }

        const viewedIds = await StoryStorage.listViewedIds(pool, {
          id_viewer_user: user.id_user,
          story_ids: rows.map((r) => r.id_story),
        });

        return {
          items: rows.map(mapStory).filter(Boolean),
          viewed_ids: viewedIds,
        };
      }
    );
  }

  static async markViewed(user, params) {
    return runWithLogs(
      log,
      "markViewed",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story inválido" };
        }

        const story = await StoryStorage.getActiveById(pool, id_story);
        if (!story) return { error: "Story não encontrada" };

        await StoryStorage.markViewed(pool, {
          id_story,
          id_viewer_user: user.id_user,
        });
        return { viewed: true, id_story };
      }
    );
  }

  static async react(user, params, body = {}) {
    return runWithLogs(
      log,
      "react",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "UsuÃ¡rio nÃ£o autenticado" };
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story invÃ¡lido" };
        }

        const emoji = String(body?.emoji || "").trim().slice(0, 16);
        if (!emoji) return { error: "emoji obrigatÃ³rio" };

        const story = await StoryStorage.getActiveById(pool, id_story);
        if (!story) return { error: "Story nÃ£o encontrada" };

        const messageText = `${emoji} reagiu ao seu story ${story.kind}`;
        const result = await ConversationService.sendMessage(user, {
          target_id: story.id_profile,
          target_type: "profile",
          body: messageText,
        });
        if (result?.error) return result;

        return {
          reacted: true,
          emoji,
          id_story,
          conversation: result.conversation,
          message: result.message,
        };
      }
    );
  }

  static async deleteMine(user, params) {
    return runWithLogs(
      log,
      "deleteMine",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story inválido" };
        }

        const existing = await StoryStorage.getByIdForOwner(pool, {
          id_story,
          id_user: user.id_user,
        });
        if (!existing) return { error: "Story não encontrada" };
        if (existing.deleted_at) return { story: mapStory(existing) };

        const deleted = await StoryStorage.softDelete(pool, {
          id_story,
          id_user: user.id_user,
        });
        return { story: mapStory(deleted || existing) };
      }
    );
  }
}

module.exports = StoryService;
