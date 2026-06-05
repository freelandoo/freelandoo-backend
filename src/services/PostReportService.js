const pool = require("../databases");
const PostReportStorage = require("../storages/PostReportStorage");
const AffiliatePayoutService = require("./AffiliatePayoutService");
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

        // Denúncia inédita reabre o alerta: zera uma resolução anterior do admin.
        if (inserted) {
          await PostReportStorage.clearResolved(pool, id_portfolio_item);
        }

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

  static async adminUnban(user, params) {
    return runWithLogs(
      log,
      "adminUnban",
      () => ({ admin: user?.id_user, id: params?.id }),
      async () => {
        const id = String(params?.id || "").trim();
        if (!UUID_RE.test(id)) return { error: "id inválido" };
        const updated = await PostReportStorage.unban(pool, {
          id_portfolio_item: id,
          resolved_by_user_id: user?.id_user,
        });
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

  static async adminResolve(user, params) {
    return runWithLogs(
      log,
      "adminResolve",
      () => ({ admin: user?.id_user, id: params?.id }),
      async () => {
        const id = String(params?.id || "").trim();
        if (!UUID_RE.test(id)) return { error: "id inválido" };
        const updated = await PostReportStorage.resolveReports(pool, {
          id_portfolio_item: id,
          resolved_by_user_id: user.id_user,
        });
        if (!updated) return { error: "Post não encontrado" };
        return { ok: true, post: updated };
      }
    );
  }

  // Resumo para o modal de alerta do admin (1x por login):
  // posts denunciados pendentes + afiliados com comissão URGENTE (>20d).
  static async alertSummary(_user) {
    return runWithLogs(
      log,
      "alertSummary",
      () => ({}),
      async () => {
        const reportedPosts = await PostReportStorage.listReportedForAlert(pool, { limit: 50 });

        let urgentAffiliates = [];
        try {
          const { items } = await AffiliatePayoutService.summaryByAffiliate({ threshold_days: 20 });
          urgentAffiliates = (items || [])
            .filter((a) => Number(a.red_cents) > 0)
            .map((a) => ({
              id_affiliate: a.id_affiliate,
              name: a.user_name,
              email: a.user_email,
              urgent_cents: Number(a.red_cents) || 0,
              unpaid_count: Number(a.unpaid_count) || 0,
              oldest_unpaid_at: a.oldest_unpaid_at,
            }));
        } catch (err) {
          // Afiliados nunca derruba o alerta de posts.
          log.warn("alertSummary.affiliates_failed", { message: err?.message });
        }

        const urgentTotalCents = urgentAffiliates.reduce((s, a) => s + a.urgent_cents, 0);

        return {
          reported_posts: reportedPosts,
          reported_posts_count: reportedPosts.length,
          urgent_affiliates: urgentAffiliates,
          urgent_affiliates_count: urgentAffiliates.length,
          urgent_total_cents: urgentTotalCents,
          has_alerts: reportedPosts.length > 0 || urgentAffiliates.length > 0,
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
