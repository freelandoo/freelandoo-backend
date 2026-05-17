const pool = require("../databases");
const BookingPayoutStorage = require("../storages/BookingPayoutStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BookingPayoutService");

const HOLDBACK_DAYS = 8;

class BookingPayoutService {
  /**
   * Cria o payout para um booking que acabou de ser confirmado pelo webhook.
   * Idempotente (UNIQUE em id_booking).
   */
  static async createFromBooking(booking) {
    return runWithLogs(log, "createFromBooking", () => ({ id_booking: booking?.id }), async () => {
      if (!booking) return { error: "Booking ausente" };
      const deposit = Number(booking.deposit_amount) || 0;
      const platform_fee = Number(booking.platform_fee_amount) || 0;
      const professional = Number(booking.professional_amount) || 0;
      if (professional <= 0) {
        log.info("skip.no_professional_amount", { id_booking: booking.id });
        return { skipped: true };
      }
      const available_at = new Date(Date.now() + HOLDBACK_DAYS * 24 * 60 * 60 * 1000);
      const created = await BookingPayoutStorage.create(pool, {
        id_booking: booking.id,
        id_profile: booking.id_profile,
        id_owner_user: booking.profile_owner_user_id,
        id_profile_service: booking.id_profile_service || null,
        client_name: booking.client_name,
        client_email: booking.client_email,
        client_whatsapp: booking.client_whatsapp,
        deposit_cents: deposit,
        platform_fee_cents: platform_fee,
        professional_cents: professional,
        net_cents: professional,
        status: "aguardando",
        available_at,
        booking_date: booking.booking_date,
        booking_start_time: booking.start_time,
      });
      return { payout: created };
    });
  }

  static async listMine(user, query = {}) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const status = query.status ? String(query.status) : null;
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const items = await BookingPayoutStorage.listForOwner(pool, user.id_user, { status, limit, offset });
      const summary = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN status='aguardando' THEN net_cents END), 0) AS aguardando_cents,
            COALESCE(SUM(CASE WHEN status='aprovado'   THEN net_cents END), 0) AS aprovado_cents,
            COALESCE(SUM(CASE WHEN status='pago'       THEN net_cents END), 0) AS pago_cents,
            COALESCE(SUM(CASE WHEN status='revertido'  THEN net_cents END), 0) AS revertido_cents,
            COUNT(*) FILTER (WHERE status='aguardando') AS aguardando_count,
            COUNT(*) FILTER (WHERE status='aprovado')   AS aprovado_count,
            COUNT(*) FILTER (WHERE status='pago')       AS pago_count
           FROM public.tb_booking_payout
          WHERE id_owner_user = $1`,
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
      const items = await BookingPayoutStorage.listAdmin(pool, { status, q, since, until, limit, offset });
      const summary = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN status='aguardando' THEN net_cents END), 0) AS aguardando_cents,
            COALESCE(SUM(CASE WHEN status='aprovado'   THEN net_cents END), 0) AS aprovado_cents,
            COALESCE(SUM(CASE WHEN status='pago'       THEN net_cents END), 0) AS pago_cents,
            COUNT(*) FILTER (WHERE status='aguardando') AS aguardando_count,
            COUNT(*) FILTER (WHERE status='aprovado')   AS aprovado_count,
            COUNT(*) FILTER (WHERE status='pago')       AS pago_count
           FROM public.tb_booking_payout`
      );
      return { items, summary: summary.rows[0] };
    });
  }

  static async markPaidOut(id_payout, note) {
    return runWithLogs(log, "markPaidOut", () => ({ id_payout }), async () => {
      const updated = await BookingPayoutStorage.markPaidOut(pool, id_payout, { note });
      if (!updated) return { error: "Payout não encontrado ou ainda não liberado" };
      return { payout: updated };
    });
  }

  static async revertByBooking(id_booking) {
    return BookingPayoutStorage.revertByBooking(pool, id_booking);
  }

  /**
   * Tratamento de charge.refunded — se o PI for de um booking, reverte
   * o payout do profissional. Devolve {ignored:true} se não for booking.
   */
  static async handleChargeRefunded(charge) {
    const payment_intent_id = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id || null;
    if (!payment_intent_id) return { ignored: true };
    const r = await pool.query(
      `SELECT id FROM public.tb_profile_bookings WHERE stripe_payment_intent_id = $1 LIMIT 1`,
      [payment_intent_id]
    );
    const id_booking = r.rows[0]?.id;
    if (!id_booking) return { ignored: true };
    const reverted = await BookingPayoutStorage.revertByBooking(pool, id_booking);
    log.info("payout.reverted_by_refund", { id_booking, reverted: !!reverted });
    return { ok: true, id_booking };
  }
}

module.exports = BookingPayoutService;
module.exports.HOLDBACK_DAYS = HOLDBACK_DAYS;
