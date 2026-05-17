const pool = require("../databases");
const SellerBalanceStorage = require("../storages/SellerBalanceStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SellerBalanceService");

class SellerBalanceService {
  static async listMine(user, query = {}) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const status = query.status ? String(query.status) : null;
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const items = await SellerBalanceStorage.listForSeller(pool, user.id_user, { status, limit, offset });
      const summary = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN status='aguardando' THEN net_cents END), 0) AS aguardando_cents,
            COALESCE(SUM(CASE WHEN status='aprovado'   THEN net_cents END), 0) AS aprovado_cents,
            COALESCE(SUM(CASE WHEN status='pago'       THEN net_cents END), 0) AS pago_cents,
            COALESCE(SUM(CASE WHEN status='revertido'  THEN net_cents END), 0) AS revertido_cents,
            COUNT(*) FILTER (WHERE status='aguardando') AS aguardando_count,
            COUNT(*) FILTER (WHERE status='aprovado')   AS aprovado_count,
            COUNT(*) FILTER (WHERE status='pago')       AS pago_count
           FROM public.tb_seller_balance
          WHERE id_seller_user = $1`,
        [user.id_user]
      );
      return { items, summary: summary.rows[0] };
    });
  }

  static async listAdmin(query = {}) {
    return runWithLogs(log, "listAdmin", () => ({ status: query?.status }), async () => {
      const status = query.status ? String(query.status) : null;
      const q = query.q ? String(query.q) : null;
      const since = query.since ? String(query.since) : null;
      const until = query.until ? String(query.until) : null;
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const items = await SellerBalanceStorage.listAdmin(pool, { status, q, since, until, limit, offset });

      const summary = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN status='aguardando' THEN net_cents END), 0) AS aguardando_cents,
            COALESCE(SUM(CASE WHEN status='aprovado'   THEN net_cents END), 0) AS aprovado_cents,
            COALESCE(SUM(CASE WHEN status='pago'       THEN net_cents END), 0) AS pago_cents,
            COUNT(*) FILTER (WHERE status='aguardando') AS aguardando_count,
            COUNT(*) FILTER (WHERE status='aprovado')   AS aprovado_count,
            COUNT(*) FILTER (WHERE status='pago')       AS pago_count
           FROM public.tb_seller_balance`
      );
      return { items, summary: summary.rows[0] };
    });
  }

  static async markPaidOut(id_balance, note) {
    return runWithLogs(log, "markPaidOut", () => ({ id_balance }), async () => {
      const updated = await SellerBalanceStorage.markPaidOut(pool, id_balance, { note });
      if (!updated) return { error: "Saldo não encontrado ou não está liberado" };
      return { balance: updated };
    });
  }
}

module.exports = SellerBalanceService;
