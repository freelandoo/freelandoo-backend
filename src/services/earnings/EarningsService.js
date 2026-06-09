const pool = require("../../databases");
const EarningsStorage = require("../../storages/EarningsStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("EarningsService");

const MAX_PER_PAGE = 60;
const DEFAULT_PER_PAGE = 24;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

class EarningsService {
  static async list(user, query = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({ user_id: user.id_user, kind: query.kind || "all", page: query.page }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const kind = typeof query.kind === "string" ? query.kind : "all";
        const profileId = typeof query.profile === "string" ? query.profile : null;
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
            profileId,
            limit: perPage,
            offset,
          }),
          EarningsStorage.aggregates(pool, user.id_user, profileId),
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

  /**
   * Série diária de ganhos pro gráfico de barras (ganhos × dias).
   * range: 7d | 30d | 90d (default 30d). Preenche dias sem movimento com zero.
   */
  static async series(user, query = {}) {
    return runWithLogs(
      log,
      "series",
      () => ({ user_id: user?.id_user, range: query.range, profile: query.profile }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const profileId = typeof query.profile === "string" ? query.profile : null;
        const days = RANGE_DAYS[query.range] || 30;

        const now = new Date();
        const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        to.setUTCDate(to.getUTCDate() + 1); // inclui o dia de hoje inteiro
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - days);

        const rows = await EarningsStorage.dailySeries(pool, {
          userId: user.id_user,
          profileId,
          from: from.toISOString(),
          to: to.toISOString(),
        });

        const byDay = new Map(rows.map((r) => [r.day, r]));
        const series = [];
        for (let i = 0; i < days; i++) {
          const d = new Date(from);
          d.setUTCDate(d.getUTCDate() + i);
          const key = d.toISOString().slice(0, 10);
          const hit = byDay.get(key);
          series.push({
            day: key,
            net_cents: hit ? Number(hit.net_cents) || 0 : 0,
            count: hit ? Number(hit.count) || 0 : 0,
          });
        }

        const total_cents = series.reduce((s, p) => s + p.net_cents, 0);
        return { range: `${days}d`, series, total_cents };
      }
    );
  }
}

module.exports = EarningsService;
