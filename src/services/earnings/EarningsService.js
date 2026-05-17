const pool = require("../../databases");
const EarningsStorage = require("../../storages/EarningsStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("EarningsService");

const MAX_PER_PAGE = 60;
const DEFAULT_PER_PAGE = 24;

class EarningsService {
  static async list(user, query = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({ user_id: user.id_user, kind: query.kind || "all", page: query.page }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const kind = typeof query.kind === "string" ? query.kind : "all";
        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const perPage = Math.min(
          MAX_PER_PAGE,
          Math.max(1, parseInt(query.per_page, 10) || DEFAULT_PER_PAGE)
        );
        const offset = (page - 1) * perPage;

        const [list, agg] = await Promise.all([
          EarningsStorage.listEarnings(pool, {
            userId: user.id_user,
            kind,
            limit: perPage,
            offset,
          }),
          EarningsStorage.aggregates(pool, user.id_user),
        ]);

        return {
          items: list.items,
          pagination: {
            page,
            per_page: perPage,
            total: list.total,
            total_pages: Math.max(1, Math.ceil(list.total / perPage)),
          },
          aggregates: agg,
        };
      }
    );
  }
}

module.exports = EarningsService;
