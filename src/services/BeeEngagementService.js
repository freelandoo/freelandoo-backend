// src/services/BeeEngagementService.js
// Engajamento do bee: like, comentários, denúncia, bookmark, eventos (share).
// XP em paridade EXATA com posts: like→like_received, share→share_received,
// comentário NÃO dá XP (post também não dá) — só notificação.
const pool = require("../databases");
const BeeEngagementStorage = require("../storages/BeeEngagementStorage");
const StoryStorage = require("../storages/StoryStorage");
const XpStorage = require("../storages/XpStorage");
const NotificationService = require("./NotificationService");
const ChatModerationService = require("./ChatModerationService");
const { assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BeeEngagementService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mesmos valores do ReportPostDialog do front (e da tb_post_report de posts).
const REPORT_CATEGORIES = new Set([
  "spam", "fraud", "harassment", "inappropriate", "hate",
  "forbidden_item", "personal_data", "other",
]);
const EVENT_TYPES = new Set(["share"]);

// Shape espelhado no CommentItem do front (comments-panel.tsx) — os aliases
// id_portfolio_comment/id_portfolio_item deixam o CommentsPanel drop-in.
function shapeComment(row) {
  return {
    id_portfolio_comment: row.id_story_comment,
    id_portfolio_item: row.id_story,
    id_user: row.id_user,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    likes_count: Number(row.likes_count) || 0,
    viewer_has_liked: !!row.viewer_has_liked,
    user: {
      username: row.username,
      display_name: row.user_display_name,
      avatar_url: row.user_avatar_url,
    },
  };
}

// Bee vivo = story kind='bee' dentro da janela de vida (getActiveById já
// aplica o predicado de vida após a mig 183 / slice B2).
async function getAliveBee(id_story) {
  if (!id_story || !UUID_RE.test(id_story)) return null;
  const story = await StoryStorage.getActiveById(pool, id_story);
  if (!story || story.kind !== "bee") return null;
  return story;
}

class BeeEngagementService {
  static async toggleLike(user, params) {
    return runWithLogs(log, "toggleLike",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const bee = await getAliveBee(params?.id_story);
        if (!bee) return { error: "Bee não encontrado", statusCode: 404 };

        const result = await BeeEngagementStorage.toggleLike(pool, {
          id_story: bee.id_story,
          id_user: user.id_user,
        });

        if (result.liked) {
          // XP paridade com post (RankingStorage.toggleLike): like_received,
          // dedupe por par (bee, usuário) via source_id.
          XpStorage.award(pool, {
            id_profile: bee.id_profile,
            event_type: "like_received",
            source_type: "story_like",
            source_id: `${bee.id_story}_${user.id_user}`,
          }).catch(() => {});
          NotificationService.notifyLike({
            actor_user_id: user.id_user,
            id_portfolio_item: bee.id_story, // entity_id genérico da notificação
            id_profile: bee.id_profile,
          }).catch(() => {});
        }
        return result;
      });
  }

  static async listComments(user, params, query = {}) {
    return runWithLogs(log, "listComments",
      () => ({ id_story: params?.id_story, cursor: query?.cursor || null }),
      async () => {
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story inválido", statusCode: 400 };
        }
        const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 50);
        const rows = await BeeEngagementStorage.listComments(pool, {
          id_story,
          cursor: query?.cursor || null,
          limit: limit + 1,
          viewer_id_user: user?.id_user || null,
        });
        const items = rows.slice(0, limit).map(shapeComment);
        const hasMore = rows.length > limit;
        return {
          items,
          has_more: hasMore,
          next_cursor: hasMore && items.length ? items[items.length - 1].created_at : null,
        };
      });
  }

  static async createComment(user, params, body = {}) {
    return runWithLogs(log, "createComment",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const minorBlock = await assertMinorPermission(user.id_user, "can_post_feed");
        if (minorBlock) return minorBlock;
        const bee = await getAliveBee(params?.id_story);
        if (!bee) return { error: "Bee não encontrado", statusCode: 404 };
        if (typeof body?.content !== "string") return { error: "content inválido", statusCode: 400 };
        const trimmed = body.content.trim();
        if (!trimmed) return { error: "Comentário não pode ser vazio", statusCode: 400 };
        if (trimmed.length > 1000) return { error: "Máximo 1000 caracteres", statusCode: 400 };

        const moderation = await ChatModerationService.moderateMessage({
          id_user: user.id_user,
          room_type: "global",
          original_text: trimmed,
        });
        if (["block", "mute_temp", "review"].includes(moderation?.action)) {
          return {
            error: moderation.user_facing_error ||
              "Conteudo bloqueado por violar as politicas da plataforma.",
            statusCode: 400,
          };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const created = await BeeEngagementStorage.createComment(client, {
            id_story: bee.id_story,
            id_user: user.id_user,
            content: trimmed,
          });
          await BeeEngagementStorage._bumpCounter(client, bee.id_story, "comments_count", 1);
          await client.query("COMMIT");

          NotificationService.notifyComment({
            actor_user_id: user.id_user,
            id_portfolio_item: bee.id_story,
            id_profile: bee.id_profile,
            content_preview: trimmed,
          }).catch(() => {});

          const full = await BeeEngagementStorage.getCommentById(pool, created.id_story_comment);
          return { comment: full ? shapeComment(full) : null };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });
  }

  static async deleteComment(user, params) {
    return runWithLogs(log, "deleteComment",
      () => ({ id_user: user?.id_user, id_comment: params?.id_story_comment }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const id = params?.id_story_comment;
        if (!id || !UUID_RE.test(id)) return { error: "id inválido", statusCode: 400 };
        const existing = await BeeEngagementStorage.getCommentById(pool, id);
        if (!existing) return { error: "Comentário não encontrado", statusCode: 404 };

        const isOwner = String(existing.id_user) === String(user.id_user);
        const isAdmin = !!user.is_admin ||
          !!user.roles?.some((r) => r.desc_role === "Administrator");
        if (!isOwner && !isAdmin) {
          return { error: "Sem permissão pra remover esse comentário", statusCode: 403 };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const deactivated = await BeeEngagementStorage.deactivateComment(client, id);
          if (deactivated) {
            await BeeEngagementStorage._bumpCounter(client, deactivated.id_story, "comments_count", -1);
          }
          await client.query("COMMIT");
          return { message: "Comentário removido" };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });
  }

  static async toggleCommentLike(user, params) {
    return runWithLogs(log, "toggleCommentLike",
      () => ({ id_user: user?.id_user, id_comment: params?.id_story_comment }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const id = params?.id_story_comment;
        if (!id || !UUID_RE.test(id)) return { error: "id inválido", statusCode: 400 };
        const existing = await BeeEngagementStorage.getCommentById(pool, id);
        if (!existing) return { error: "Comentário não encontrado", statusCode: 404 };
        return BeeEngagementStorage.toggleCommentLike(pool, {
          id_story_comment: id,
          id_user: user.id_user,
        });
      });
  }

  static async report(user, params, body = {}) {
    return runWithLogs(log, "report",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const bee = await getAliveBee(params?.id_story);
        if (!bee) return { error: "Bee não encontrado", statusCode: 404 };
        const category = String(body?.reason_category || "").trim();
        if (!REPORT_CATEGORIES.has(category)) {
          return { error: "reason_category inválida", statusCode: 400 };
        }
        const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;
        const created = await BeeEngagementStorage.createReport(pool, {
          id_story: bee.id_story,
          reporter_user_id: user.id_user,
          reason_category: category,
          reason,
        });
        return { reported: true, duplicated: !created };
      });
  }

  static async toggleBookmark(user, params) {
    return runWithLogs(log, "toggleBookmark",
      () => ({ id_user: user?.id_user, id_story: params?.id_story }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const bee = await getAliveBee(params?.id_story);
        if (!bee) return { error: "Bee não encontrado", statusCode: 404 };
        return BeeEngagementStorage.toggleBookmark(pool, {
          id_story: bee.id_story,
          id_user: user.id_user,
        });
      });
  }

  static async recordEvent(user, body = {}) {
    return runWithLogs(log, "recordEvent",
      () => ({ id_story: body?.id_story, event_type: body?.event_type }),
      async () => {
        const id_story = body?.id_story;
        const event_type = String(body?.event_type || "").trim();
        if (!EVENT_TYPES.has(event_type)) {
          return { error: "event_type inválido", statusCode: 400 };
        }
        const bee = await getAliveBee(id_story);
        if (!bee) return { error: "Bee não encontrado", statusCode: 404 };
        const session_id = typeof body?.session_id === "string"
          ? body.session_id.slice(0, 64) : null;

        const result = await BeeEngagementStorage.recordEvent(pool, {
          id_story: bee.id_story,
          id_user: user?.id_user || null,
          session_id,
          event_type,
        });

        // XP paridade com PortfolioEventService: share → share_received.
        if (result.counted && event_type === "share") {
          XpStorage.award(pool, {
            id_profile: bee.id_profile,
            event_type: "share_received",
            source_type: "story_event",
            source_id: `${bee.id_story}_${session_id || "anon"}_share`,
          }).catch(() => {});
        }
        return { ok: true, counted: result.counted };
      });
  }

  // ── Admin (denúncias) ─────────────────────────────────────────────────────
  static async adminListReported() {
    return runWithLogs(log, "adminListReported", () => ({}), async () => {
      const items = await BeeEngagementStorage.adminListReported(pool, { limit: 100 });
      return { items };
    });
  }

  static async adminRemove(params) {
    return runWithLogs(log, "adminRemove",
      () => ({ id_story: params?.id_story }),
      async () => {
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story inválido", statusCode: 400 };
        }
        await BeeEngagementStorage.adminSoftDeleteStory(pool, { id_story });
        await BeeEngagementStorage.adminResolveReports(pool, { id_story });
        return { removed: true };
      });
  }

  static async adminResolve(params) {
    return runWithLogs(log, "adminResolve",
      () => ({ id_story: params?.id_story }),
      async () => {
        const id_story = params?.id_story;
        if (!id_story || !UUID_RE.test(id_story)) {
          return { error: "id_story inválido", statusCode: 400 };
        }
        await BeeEngagementStorage.adminResolveReports(pool, { id_story });
        return { resolved: true };
      });
  }
}

module.exports = BeeEngagementService;
