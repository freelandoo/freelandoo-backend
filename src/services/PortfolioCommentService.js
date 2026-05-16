const pool = require("../databases");
const PortfolioCommentStorage = require("../storages/PortfolioCommentStorage");
const NotificationService = require("./NotificationService");
const { assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PortfolioCommentService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIN_CONTENT = 1;
const MAX_CONTENT = 1000;

function shapeRow(row) {
  return {
    id_portfolio_comment: row.id_portfolio_comment,
    id_portfolio_item: row.id_portfolio_item,
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

class PortfolioCommentService {
  static async list(params) {
    return runWithLogs(
      log,
      "list",
      () => ({
        id_portfolio_item: params?.id_portfolio_item,
        cursor: params?.cursor || null,
      }),
      async () => {
        const id_portfolio_item = params?.id_portfolio_item;
        if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item)) {
          return { error: "id_portfolio_item inválido", statusCode: 400 };
        }
        const limit = Math.min(Math.max(Number(params?.limit) || 20, 1), 50);
        const cursor = params?.cursor || null;
        const rows = await PortfolioCommentStorage.listForItem(pool, {
          id_portfolio_item,
          cursor,
          limit: limit + 1, // pega 1 extra pra saber se tem mais
          viewer_id_user: params?.viewer?.id_user || null,
        });
        const items = rows.slice(0, limit).map(shapeRow);
        const hasMore = rows.length > limit;
        const lastCursor =
          hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
        return {
          items,
          has_more: hasMore,
          next_cursor: lastCursor,
        };
      },
    );
  }

  static async create({ user, id_portfolio_item, content }) {
    return runWithLogs(
      log,
      "create",
      () => ({
        id_user: user?.id_user,
        id_portfolio_item,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const minorBlock = await assertMinorPermission(user.id_user, "can_post_feed");
        if (minorBlock) return minorBlock;
        if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item)) {
          return { error: "id_portfolio_item inválido", statusCode: 400 };
        }
        if (typeof content !== "string") {
          return { error: "content inválido", statusCode: 400 };
        }
        const trimmed = content.trim();
        if (trimmed.length < MIN_CONTENT) {
          return { error: "Comentário não pode ser vazio", statusCode: 400 };
        }
        if (trimmed.length > MAX_CONTENT) {
          return { error: `Máximo ${MAX_CONTENT} caracteres`, statusCode: 400 };
        }

        const itemOk = await PortfolioCommentStorage.itemExists(
          pool,
          id_portfolio_item,
        );
        if (!itemOk) return { error: "Item não encontrado", statusCode: 404 };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const created = await PortfolioCommentStorage.create(client, {
            id_portfolio_item,
            id_user: user.id_user,
            content: trimmed,
          });
          await PortfolioCommentStorage.bumpItemCounter(
            client,
            id_portfolio_item,
            1,
          );
          await client.query("COMMIT");

          const full = await PortfolioCommentStorage.getEnrichedById(
            pool,
            created.id_portfolio_comment,
            user.id_user,
          );

          // Notificação fire-and-forget — busca o id_profile dono do item.
          try {
            const ownerLookup = await pool.query(
              `SELECT id_profile FROM public.tb_profile_portfolio_item
                WHERE id_portfolio_item = $1 LIMIT 1`,
              [id_portfolio_item]
            );
            const id_profile = ownerLookup.rows[0]?.id_profile;
            if (id_profile) {
              NotificationService.notifyComment({
                actor_user_id: user.id_user,
                id_portfolio_item,
                id_profile,
                content_preview: trimmed,
              }).catch(() => {});
            }
          } catch {
            /* fire-and-forget */
          }

          return { comment: full ? shapeRow(full) : null };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }

  static async toggleLike({ user, id_portfolio_comment }) {
    return runWithLogs(
      log,
      "toggleLike",
      () => ({
        id_user: user?.id_user,
        id_portfolio_comment,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        if (!id_portfolio_comment || !UUID_RE.test(id_portfolio_comment)) {
          return { error: "id_portfolio_comment inválido", statusCode: 400 };
        }
        const existing = await PortfolioCommentStorage.getById(
          pool,
          id_portfolio_comment,
        );
        if (!existing) return { error: "Comentário não encontrado", statusCode: 404 };

        const result = await PortfolioCommentStorage.toggleLike(pool, {
          id_portfolio_comment,
          id_user: user.id_user,
        });
        return {
          liked: result.liked,
          likes_count: result.likes_count,
        };
      },
    );
  }

  static async delete({ user, id_portfolio_comment }) {
    return runWithLogs(
      log,
      "delete",
      () => ({
        id_user: user?.id_user,
        id_portfolio_comment,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        if (!id_portfolio_comment || !UUID_RE.test(id_portfolio_comment)) {
          return { error: "id_portfolio_comment inválido", statusCode: 400 };
        }

        const existing = await PortfolioCommentStorage.getById(
          pool,
          id_portfolio_comment,
        );
        if (!existing) return { error: "Comentário não encontrado", statusCode: 404 };

        const isOwner = String(existing.id_user) === String(user.id_user);
        const isAdmin =
          !!user.is_admin ||
          !!user.roles?.some((r) => r.desc_role === "Administrator");
        if (!isOwner && !isAdmin) {
          return { error: "Sem permissão pra remover esse comentário", statusCode: 403 };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const deactivated = await PortfolioCommentStorage.deactivate(
            client,
            id_portfolio_comment,
          );
          if (deactivated) {
            await PortfolioCommentStorage.bumpItemCounter(
              client,
              deactivated.id_portfolio_item,
              -1,
            );
          }
          await client.query("COMMIT");
          return { message: "Comentário removido" };
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

module.exports = PortfolioCommentService;
