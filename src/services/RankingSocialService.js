// src/services/RankingSocialService.js
// Likes e comentarios do /ranking. Leitura e PUBLICA (a pagina do ranking nao
// exige login); escrita exige a conta user logada — interacoes nunca sao
// assinadas por subperfil. Espelha o CasaAudienceInteractionService.
const pool = require("../databases");
const RankingSocialStorage = require("../storages/RankingSocialStorage");
const { assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("RankingSocialService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT = 1000;

function shapeSummary(row, id_profile) {
  return {
    id_profile,
    likes_count: Number(row?.likes_count) || 0,
    comments_count: Number(row?.comments_count) || 0,
    viewer_has_liked: !!row?.viewer_has_liked,
  };
}

function shapeComment(row) {
  return {
    id_ranking_comment: row.id_ranking_comment,
    id_profile: row.id_profile,
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

class RankingSocialService {
  // GET /ranking/social/summary?ids=... — publico (viewer opcional)
  static async summary(user, query = {}) {
    return runWithLogs(
      log,
      "summary",
      () => ({ id_user: user?.id_user ?? null }),
      async () => {
        const ids = String(query.ids || "")
          .split(",")
          .map((v) => v.trim())
          .filter((v) => UUID_RE.test(v))
          .slice(0, 100);
        if (!ids.length) return { items: [] };
        const rows = await RankingSocialStorage.listSummaries(pool, {
          profile_ids: Array.from(new Set(ids)),
          viewer_id_user: user?.id_user ?? null,
        });
        return {
          items: rows.map((r) => shapeSummary(r, r.id_profile)),
        };
      },
    );
  }

  // GET /ranking/social/:id_profile/comments — publico (viewer opcional)
  static async getInteraction(user, params = {}, query = {}) {
    return runWithLogs(
      log,
      "getInteraction",
      () => ({ id_user: user?.id_user ?? null, id_profile: params?.id_profile }),
      async () => {
        const id_profile = params.id_profile;
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile invalido", statusCode: 400 };
        }
        if (!(await RankingSocialStorage.profileExists(pool, id_profile))) {
          return { error: "Perfil não encontrado", statusCode: 404 };
        }

        const viewer_id_user = user?.id_user ?? null;
        const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
        const cursor = query.cursor || null;
        const [summary, rows] = await Promise.all([
          RankingSocialStorage.getSummary(pool, { id_profile, viewer_id_user }),
          RankingSocialStorage.listComments(pool, {
            id_profile,
            cursor,
            limit: limit + 1,
            viewer_id_user,
          }),
        ]);
        const comments = rows.slice(0, limit).map(shapeComment);
        const hasMore = rows.length > limit;
        const nextCursor =
          hasMore && comments.length > 0 ? comments[comments.length - 1].created_at : null;

        return {
          target: shapeSummary(summary, id_profile),
          comments,
          has_more: hasMore,
          next_cursor: nextCursor,
        };
      },
    );
  }

  // POST /ranking/social/:id_profile/like — auth
  static async toggleProfileLike(user, params = {}) {
    return runWithLogs(
      log,
      "toggleProfileLike",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const id_profile = params.id_profile;
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile invalido", statusCode: 400 };
        }
        if (!(await RankingSocialStorage.profileExists(pool, id_profile))) {
          return { error: "Perfil não encontrado", statusCode: 404 };
        }

        return RankingSocialStorage.toggleProfileLike(pool, {
          id_profile,
          id_user: user.id_user,
        });
      },
    );
  }

  // POST /ranking/social/:id_profile/comments — auth
  static async createComment(user, params = {}, body = {}) {
    return runWithLogs(
      log,
      "createComment",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const minorBlock = await assertMinorPermission(user.id_user, "can_post_feed");
        if (minorBlock) return minorBlock;

        const id_profile = params.id_profile;
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile invalido", statusCode: 400 };
        }
        if (!(await RankingSocialStorage.profileExists(pool, id_profile))) {
          return { error: "Perfil não encontrado", statusCode: 404 };
        }

        if (typeof body.content !== "string") {
          return { error: "content invalido", statusCode: 400 };
        }
        const content = body.content.trim();
        if (!content) return { error: "Comentário não pode ser vazio", statusCode: 400 };
        if (content.length > MAX_CONTENT) {
          return { error: `Máximo ${MAX_CONTENT} caracteres`, statusCode: 400 };
        }

        const created = await RankingSocialStorage.createComment(pool, {
          id_profile,
          id_user: user.id_user,
          content,
        });

        const [full, summary] = await Promise.all([
          RankingSocialStorage.getEnrichedCommentById(
            pool,
            created.id_ranking_comment,
            user.id_user,
          ),
          RankingSocialStorage.getSummary(pool, {
            id_profile,
            viewer_id_user: user.id_user,
          }),
        ]);
        return {
          comment: full ? shapeComment(full) : null,
          target: shapeSummary(summary, id_profile),
        };
      },
    );
  }

  // POST /ranking/social/comments/:comment_id/like — auth
  static async toggleCommentLike(user, params = {}) {
    return runWithLogs(
      log,
      "toggleCommentLike",
      () => ({ id_user: user?.id_user, comment_id: params?.comment_id }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const commentId = params.comment_id;
        if (!commentId || !UUID_RE.test(commentId)) {
          return { error: "comment_id invalido", statusCode: 400 };
        }
        const existing = await RankingSocialStorage.getCommentById(pool, commentId);
        if (!existing) return { error: "Comentário não encontrado", statusCode: 404 };

        return RankingSocialStorage.toggleCommentLike(pool, {
          id_ranking_comment: commentId,
          id_user: user.id_user,
        });
      },
    );
  }

  // DELETE /ranking/social/comments/:comment_id — auth (autor apenas)
  static async deleteComment(user, params = {}) {
    return runWithLogs(
      log,
      "deleteComment",
      () => ({ id_user: user?.id_user, comment_id: params?.comment_id }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const commentId = params.comment_id;
        if (!commentId || !UUID_RE.test(commentId)) {
          return { error: "comment_id invalido", statusCode: 400 };
        }
        const existing = await RankingSocialStorage.getCommentById(pool, commentId);
        if (!existing) return { error: "Comentário não encontrado", statusCode: 404 };
        if (String(existing.id_user) !== String(user.id_user)) {
          return { error: "Sem permissão para remover este comentário", statusCode: 403 };
        }

        await RankingSocialStorage.deactivateComment(pool, commentId);
        return { message: "Comentário removido" };
      },
    );
  }
}

module.exports = RankingSocialService;
