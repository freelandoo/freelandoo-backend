const pool = require("../databases");
const CasaAudienceInteractionStorage = require("../storages/CasaAudienceInteractionStorage");
const { assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CasaAudienceInteractionService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_CONTENT = 1000;

function text(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function externalId(value) {
  const v = text(value, 160);
  if (!v || !EXTERNAL_ID_RE.test(v)) return null;
  return v;
}

function shapeSummary(row, external_user_id) {
  return {
    external_user_id,
    likes_count: Number(row?.likes_count) || 0,
    comments_count: Number(row?.comments_count) || 0,
    viewer_has_liked: !!row?.viewer_has_liked,
  };
}

function shapeComment(row) {
  return {
    id_casa_audience_comment: row.id_casa_audience_comment,
    external_user_id: row.external_user_id,
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

async function ensureTarget(conn, params) {
  const external_user_id = externalId(params?.external_user_id);
  if (!external_user_id) return null;
  await CasaAudienceInteractionStorage.upsertTarget(conn, {
    external_user_id,
    user_login: text(params?.user_login, 160),
    avatar_url: text(params?.avatar_url, 600),
  });
  return external_user_id;
}

class CasaAudienceInteractionService {
  static async summary(user, query = {}) {
    return runWithLogs(
      log,
      "summary",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Nao autenticado", statusCode: 401 };
        const ids = String(query.ids || "")
          .split(",")
          .map((v) => externalId(decodeURIComponent(v)))
          .filter(Boolean)
          .slice(0, 100);
        if (!ids.length) return { items: [] };
        const rows = await CasaAudienceInteractionStorage.listSummaries(pool, {
          external_user_ids: Array.from(new Set(ids)),
          viewer_id_user: user.id_user,
        });
        return {
          items: rows.map((r) => shapeSummary(r, r.external_user_id)),
        };
      },
    );
  }

  static async getInteraction(user, params = {}, query = {}) {
    return runWithLogs(
      log,
      "getInteraction",
      () => ({ id_user: user?.id_user, external_user_id: params?.external_user_id }),
      async () => {
        if (!user?.id_user) return { error: "Nao autenticado", statusCode: 401 };
        const external_user_id = await ensureTarget(pool, {
          external_user_id: params.external_user_id,
          user_login: query.user_login,
          avatar_url: query.avatar_url,
        });
        if (!external_user_id) return { error: "external_user_id invalido", statusCode: 400 };

        const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
        const cursor = query.cursor || null;
        const [summary, rows] = await Promise.all([
          CasaAudienceInteractionStorage.getSummary(pool, {
            external_user_id,
            viewer_id_user: user.id_user,
          }),
          CasaAudienceInteractionStorage.listComments(pool, {
            external_user_id,
            cursor,
            limit: limit + 1,
            viewer_id_user: user.id_user,
          }),
        ]);
        const comments = rows.slice(0, limit).map(shapeComment);
        const hasMore = rows.length > limit;
        const nextCursor =
          hasMore && comments.length > 0 ? comments[comments.length - 1].created_at : null;

        return {
          target: shapeSummary(summary, external_user_id),
          comments,
          has_more: hasMore,
          next_cursor: nextCursor,
        };
      },
    );
  }

  static async toggleTargetLike(user, params = {}, body = {}) {
    return runWithLogs(
      log,
      "toggleTargetLike",
      () => ({ id_user: user?.id_user, external_user_id: params?.external_user_id }),
      async () => {
        if (!user?.id_user) return { error: "Nao autenticado", statusCode: 401 };
        const external_user_id = await ensureTarget(pool, {
          external_user_id: params.external_user_id,
          user_login: body.user_login,
          avatar_url: body.avatar_url,
        });
        if (!external_user_id) return { error: "external_user_id invalido", statusCode: 400 };

        return CasaAudienceInteractionStorage.toggleTargetLike(pool, {
          external_user_id,
          id_user: user.id_user,
        });
      },
    );
  }

  static async createComment(user, params = {}, body = {}) {
    return runWithLogs(
      log,
      "createComment",
      () => ({ id_user: user?.id_user, external_user_id: params?.external_user_id }),
      async () => {
        if (!user?.id_user) return { error: "Nao autenticado", statusCode: 401 };
        const minorBlock = await assertMinorPermission(user.id_user, "can_post_feed");
        if (minorBlock) return minorBlock;

        const external_user_id = await ensureTarget(pool, {
          external_user_id: params.external_user_id,
          user_login: body.user_login,
          avatar_url: body.avatar_url,
        });
        if (!external_user_id) return { error: "external_user_id invalido", statusCode: 400 };

        if (typeof body.content !== "string") {
          return { error: "content invalido", statusCode: 400 };
        }
        const content = body.content.trim();
        if (!content) return { error: "Comentario nao pode ser vazio", statusCode: 400 };
        if (content.length > MAX_CONTENT) {
          return { error: `Maximo ${MAX_CONTENT} caracteres`, statusCode: 400 };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const created = await CasaAudienceInteractionStorage.createComment(client, {
            external_user_id,
            id_user: user.id_user,
            content,
          });
          await CasaAudienceInteractionStorage.recomputeTargetCounts(client, external_user_id);
          await client.query("COMMIT");

          const full = await CasaAudienceInteractionStorage.getEnrichedCommentById(
            pool,
            created.id_casa_audience_comment,
            user.id_user,
          );
          const summary = await CasaAudienceInteractionStorage.getSummary(pool, {
            external_user_id,
            viewer_id_user: user.id_user,
          });
          return {
            comment: full ? shapeComment(full) : null,
            target: shapeSummary(summary, external_user_id),
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }

  static async toggleCommentLike(user, params = {}) {
    return runWithLogs(
      log,
      "toggleCommentLike",
      () => ({ id_user: user?.id_user, comment_id: params?.comment_id }),
      async () => {
        if (!user?.id_user) return { error: "Nao autenticado", statusCode: 401 };
        const commentId = params.comment_id;
        if (!commentId || !UUID_RE.test(commentId)) {
          return { error: "comment_id invalido", statusCode: 400 };
        }
        const existing = await CasaAudienceInteractionStorage.getCommentById(pool, commentId);
        if (!existing) return { error: "Comentario nao encontrado", statusCode: 404 };

        return CasaAudienceInteractionStorage.toggleCommentLike(pool, {
          id_casa_audience_comment: commentId,
          id_user: user.id_user,
        });
      },
    );
  }

  static async deleteComment(user, params = {}) {
    return runWithLogs(
      log,
      "deleteComment",
      () => ({ id_user: user?.id_user, comment_id: params?.comment_id }),
      async () => {
        if (!user?.id_user) return { error: "Nao autenticado", statusCode: 401 };
        const commentId = params.comment_id;
        if (!commentId || !UUID_RE.test(commentId)) {
          return { error: "comment_id invalido", statusCode: 400 };
        }
        const existing = await CasaAudienceInteractionStorage.getCommentById(pool, commentId);
        if (!existing) return { error: "Comentario nao encontrado", statusCode: 404 };
        if (String(existing.id_user) !== String(user.id_user)) {
          return { error: "Sem permissao para remover este comentario", statusCode: 403 };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const deactivated = await CasaAudienceInteractionStorage.deactivateComment(
            client,
            commentId,
          );
          if (deactivated) {
            await CasaAudienceInteractionStorage.recomputeTargetCounts(
              client,
              deactivated.external_user_id,
            );
          }
          await client.query("COMMIT");
          return { message: "Comentario removido" };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CasaAudienceInteractionService;
