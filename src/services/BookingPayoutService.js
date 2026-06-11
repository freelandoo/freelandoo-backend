const pool = require("../databases");
const BookingPayoutStorage = require("../storages/BookingPayoutStorage");
const ClanPayoutStorage = require("../storages/ClanPayoutStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { isFullRefund } = require("../utils/refunds");
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
      // Clan: o líquido é rateado entre os anexados (tb_clan_payout via
      // BookingService.recordClanSplitForBooking), não vai pro payout único do dono.
      const profile = await ProfileStorage.getProfileById(pool, booking.id_profile);
      if (profile?.is_clan) {
        log.info("skip.clan_booking", { id_booking: booking.id });
        return { skipped: true, reason: "clan_split" };
      }
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
      const bookingItems = await BookingPayoutStorage.listForOwner(pool, user.id_user, { status, limit, offset });
      // Saldo é fonte única: une os splits de clan (serviço/curso) ao saldo.
      const clanRows = await ClanPayoutStorage.listForOwner(pool, user.id_user, { status, limit, offset });
      const clanItems = clanRows.map((cp) => ({
        ...cp,
        source: "clan",
        net_cents: cp.amount_cents,
        professional_cents: cp.amount_cents,
        profile_display_name: cp.clan_display_name,
        service_name:
          cp.source_type === "clan_course" ? "Curso do clan" : "Serviço do clan",
      }));
      const items = [...bookingItems.map((b) => ({ ...b, source: "booking" })), ...clanItems]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);

      const bSum = (await pool.query(
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
      )).rows[0];
      const cSum = await ClanPayoutStorage.summaryForOwner(pool, user.id_user);
      const summary = {
        aguardando_cents: Number(bSum.aguardando_cents) + Number(cSum.aguardando_cents),
        aprovado_cents: Number(bSum.aprovado_cents) + Number(cSum.aprovado_cents),
        pago_cents: Number(bSum.pago_cents) + Number(cSum.pago_cents),
        revertido_cents: Number(bSum.revertido_cents) + Number(cSum.revertido_cents),
        aguardando_count: Number(bSum.aguardando_count),
        aprovado_count: Number(bSum.aprovado_count),
        pago_count: Number(bSum.pago_count),
      };
      return { items, summary };
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
    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", {
        id_booking,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
      });
      return { partial: true };
    }
    const reverted = await BookingPayoutStorage.revertByBooking(pool, id_booking);
    // Clan: reverte também os splits de membros (não há booking payout único).
    const clanReverted = await ClanPayoutStorage.revertBySource(pool, "clan_service", id_booking);
    // Estorno também cancela o agendamento (o cliente não vê mais "confirmado").
    await pool.query(
      `UPDATE public.tb_profile_bookings
          SET status = 'canceled', payment_status = 'refunded', updated_at = NOW()
        WHERE id = $1 AND status NOT IN ('canceled','expired')`,
      [id_booking]
    );
    log.info("payout.reverted_by_refund", {
      id_booking,
      reverted: !!reverted,
      clan_reverted: clanReverted.length,
    });
    return { ok: true, id_booking };
  }

  /**
   * Reconciliação: bookings confirmados/pagos que ficaram SEM linha de payout
   * (a criação no webhook falhou e só logou). Recria o payout + o split de clan.
   * Idempotente: createFromBooking tem UNIQUE em id_booking e o split é no-op
   * se já existir. Roda no scheduler do boot.
   */
  static async reconcileMissing() {
    return runWithLogs(log, "reconcileMissing", () => ({}), async () => {
      const { rows } = await pool.query(
        `SELECT b.*
           FROM public.tb_profile_bookings b
           LEFT JOIN public.tb_booking_payout p ON p.id_booking = b.id
          WHERE b.status = 'confirmed'
            AND b.payment_status = 'paid'
            AND p.id_payout IS NULL
            AND b.created_at > NOW() - INTERVAL '30 days'
          ORDER BY b.created_at ASC
          LIMIT 50`
      );
      if (rows.length === 0) return { processed: 0 };
      const BookingService = require("./BookingService");
      let created = 0;
      for (const booking of rows) {
        try {
          const r = await BookingPayoutService.createFromBooking(booking);
          if (r?.payout) created++;
          await BookingService.recordClanSplitForBooking(booking);
        } catch (err) {
          log.error("reconcile.booking_fail", { id_booking: booking.id, message: err.message });
        }
      }
      return { processed: rows.length, created };
    });
  }
}

module.exports = BookingPayoutService;
module.exports.HOLDBACK_DAYS = HOLDBACK_DAYS;
