const pool = require("../databases");
const StoryStorage = require("../storages/StoryStorage");
const uploadStoryVideoToR2 = require("../integrations/r2/uploadStoryVideo");
const { processPortfolioMedia } = require("../utils/mediaProcessing");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoryService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KINDS = new Set(["trampo", "rest"]);

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
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    caption: row.caption,
    created_at: row.created_at,
    expires_at: row.expires_at,
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
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile inválido" };
        }
        if (!file) return { error: "Arquivo não enviado" };

        const kind = normalizeKind(body?.kind);
        if (!kind) return { error: "kind inválido (use 'trampo' ou 'rest')" };

        const duration_seconds = normalizeDuration(body?.duration_seconds);
        if (!duration_seconds) {
          return {
            error:
              "duration_seconds inválido — informe a duração em segundos (1..60)",
          };
        }

        const width = normalizeOptionalInt(body?.width);
        const height = normalizeOptionalInt(body?.height);
        const caption = normalizeCaption(body?.caption);

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const profile = await StoryStorage.getProfileForOwnership(client, {
            id_profile,
            id_user: user.id_user,
          });
          if (!profile) {
            await client.query("ROLLBACK");
            return { error: "Sem permissão para postar por este perfil" };
          }
          if (!profile.is_active) {
            await client.query("ROLLBACK");
            return { error: "Perfil inativo não pode postar story" };
          }

          if (kind === "trampo") {
            if (profile.is_clan) {
              await client.query("ROLLBACK");
              return { error: "Clans não podem postar trampo" };
            }
            const subscribed = await StoryStorage.profileHasActiveSubscription(
              client,
              id_profile
            );
            if (!subscribed) {
              await client.query("ROLLBACK");
              return {
                error: "Trampo é exclusivo de subperfis com assinatura ativa",
              };
            }
          }

          let processedFile;
          try {
            processedFile = await processPortfolioMedia(file, "video");
          } catch (err) {
            await client.query("ROLLBACK");
            return { error: err?.message || "Falha ao processar vídeo" };
          }

          const uploaded = await uploadStoryVideoToR2({
            id_profile,
            file: processedFile,
          });

          const finalWidth =
            width || processedFile.mediaMetadata?.width || null;
          const finalHeight =
            height || processedFile.mediaMetadata?.height || null;

          const story = await StoryStorage.insertStory(client, {
            id_profile,
            id_user: user.id_user,
            kind,
            video_url: uploaded.url,
            thumbnail_url: uploaded.thumbnail_url,
            storage_key: uploaded.key,
            thumbnail_key: uploaded.thumbnail_key,
            duration_seconds,
            width: finalWidth,
            height: finalHeight,
            caption,
            metadata: {
              ...(processedFile.mediaMetadata || {}),
              storage_key: uploaded.key,
              ...(uploaded.thumbnail_key
                ? { thumbnail_storage_key: uploaded.thumbnail_key }
                : {}),
            },
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
