const pool = require("../databases");
const PostReportStorage = require("../storages/PostReportStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PostReportService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PostReportService {
  static async report(user, params, body) {
    return runWithLogs(
      log,
      "report",
      () => ({
        id_user: user?.id_user,
        id_portfolio_item: params?.id_portfolio_item,
        category: body?.reason_category,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const id_portfolio_item = String(params?.id_portfolio_item || params?.id || "").trim();
        if (!UUID_RE.test(id_portfolio_item)) {
          return { error: "id_portfolio_item inválido" };
        }

        const rawCategory = String(body?.reason_category || "").trim();
        if (!PostReportStorage.REASON_CATEGORIES.has(rawCategory)) {
          return { error: "reason_category inválido" };
        }
        const reason = body?.reason ? String(body.reason).slice(0, 600) : null;

        const inserted = await PostReportStorage.insertReport(pool, {
          id_portfolio_item,
          reporter_user_id: user.id_user,
          reason_category: rawCategory,
          reason,
        });

        // Recalcula contadores mesmo se duplicate (idempotente).
        await PostReportStorage.recountReports(pool, id_portfolio_item);

        return { ok: true, already_reported: !inserted };
      }
    );
  }

  static async adminBan(user, params) {
    return runWithLogs(
      log,
      "adminBan",
      () => ({ admin: user?.id_user, id: params?.id }),
      async () => {
        const id = String(params?.id || "").trim();
        if (!UUID_RE.test(id)) return { error: "id inválido" };
        const updated = await PostReportStorage.ban(pool, {
          id_portfolio_item: id,
          banned_by_user_id: user.id_user,
        });
        if (!updated) return { error: "Post não encontrado" };
        return { ok: true, post: updated };
      }
    );
  }

  static async adminUnban(_user, params) {
    return runWithLogs(
      log,
      "adminUnban",
      () => ({ id: params?.id }),
      async () => {
        const id = String(params?.id || "").trim();
        if (!UUID_RE.test(id)) return { error: "id inválido" };
        const updated = await PostReportStorage.unban(pool, id);
        if (!updated) return { error: "Post não encontrado" };
        return { ok: true, post: updated };
      }
    );
  }

  static async adminList(_user, query = {}) {
    return runWithLogs(
      log,
      "adminList",
      () => ({ page: query?.page, q: query?.q }),
      async () => {
        const limit = Math.min(60, Math.max(1, parseInt(query.per_page, 10) || 24));
        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const offset = (page - 1) * limit;
        const minReports = query.min_reports != null
          ? Math.max(0, parseInt(query.min_reports, 10) || 0)
          : 0;
        const q = typeof query.q === "string" ? query.q.trim() : "";
        const sort = typeof query.sort === "string" ? query.sort : "reports";

        const { items, total } = await PostReportStorage.adminList(pool, {
          q,
          sort,
          minReports,
          limit,
          offset,
        });
        return {
          items,
          pagination: {
            page,
            per_page: limit,
            total,
            total_pages: Math.max(1, Math.ceil(total / limit)),
          },
        };
      }
    );
  }

  static async adminPreview(_user, params) {
    return runWithLogs(
      log,
      "adminPreview",
      () => ({ id: params?.id }),
      async () => {
        const id = String(params?.id || "").trim();
        if (!UUID_RE.test(id)) return { error: "id inválido" };
        const preview = await PostReportStorage.adminGetPreview(pool, id);
        if (!preview) return { error: "Post não encontrado" };
        return { post: preview };
      }
    );
  }
}

module.exports = PostReportService;
