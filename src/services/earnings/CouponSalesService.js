const pool = require("../../databases");
const CouponSalesStorage = require("../../storages/CouponSalesStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("CouponSalesService");

const MAX_PER_PAGE = 60;
const DEFAULT_PER_PAGE = 24;

function normalizeStatus(raw) {
  switch (raw) {
    case "PAID":      return "paid";
    case "APPROVED":  return "available";
    case "REVERSED":  return "reversed";
    default:          return "pending";
  }
}

function mapRow(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    status: normalizeStatus(row.status),
    raw_status: row.status,
    coupon_code: row.coupon_code,
    order: {
      id: row.id_order,
      paid_at: row.order_paid_at,
      status: row.order_status,
    },
    buyer: {
      id: row.buyer_id,
      name: row.buyer_name,
      email: row.buyer_email,
    },
    item: {
      name: row.item_name || null,
      count: row.item_count || 0,
    },
    amounts: {
      gross_cents: row.order_total_cents,
      discount_cents: row.discount_cents,
      final_cents: Math.max(0, (row.order_total_cents || 0) - (row.discount_cents || 0)),
      commission_cents: row.commission_cents,
      commission_percent: row.commission_percent,
    },
    timeline: {
      eligible_at: row.eligible_at,
      approved_at: row.approved_at,
      paid_at: row.paid_at,
    },
  };
}

class CouponSalesService {
  static async list(user, query = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({ user_id: user?.id_user, page: query.page }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const perPage = Math.min(
          MAX_PER_PAGE,
          Math.max(1, parseInt(query.per_page, 10) || DEFAULT_PER_PAGE)
        );
        const offset = (page - 1) * perPage;

        const { items, total } = await CouponSalesStorage.listSales(pool, {
          userId: user.id_user,
          limit: perPage,
          offset,
        });

        return {
          items: items.map(mapRow),
          pagination: {
            page,
            per_page: perPage,
            total,
            total_pages: Math.max(1, Math.ceil(total / perPage)),
          },
        };
      }
    );
  }
}

module.exports = CouponSalesService;
