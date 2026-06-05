const pool = require("../databases");
const ProtectionStorage = require("../storages/ProtectionStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const SellerBalanceStorage = require("../storages/SellerBalanceStorage");
const BookingPayoutStorage = require("../storages/BookingPayoutStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProtectionService");

// Janela de disputa (CDC art. 49) e holdback do repasse (espelha os ledgers).
const WINDOW_DAYS = 7;
const HOLDBACK_DAYS = 8;

function plusDays(base, days) {
  const t = base ? new Date(base).getTime() : Date.now();
  return new Date(t + days * 24 * 60 * 60 * 1000);
}

class ProtectionService {
  /**
   * Abre o caso de proteção no momento do pagamento (substitui a criação direta
   * do ledger). `conn` pode ser a transação do webhook ou o pool. Idempotente.
   */
  static async openCase(conn, { domain, ref_id }) {
    if (!ProtectionStorage.DOMAINS.has(domain)) return { error: "domain inválido" };
    const c = await ProtectionStorage.openCase(conn || pool, { domain, ref_id });
    return { case: c };
  }

  /**
   * Regra de início da janela:
   *  - product → basta a prova de postagem (shipment).
   *  - booking → precisa da prova de chegada (arrival) E da confirmação do cliente.
   * Idempotente (startWindow só age em awaiting_fulfillment).
   */
  static async maybeStartWindow(conn, caseRow) {
    if (!caseRow || caseRow.state !== "awaiting_fulfillment") return caseRow;
    let ready = false;
    if (caseRow.domain === "product") {
      ready = await ProtectionStorage.hasProof(conn, caseRow.id, "shipment");
    } else if (caseRow.domain === "booking") {
      const hasArrival = await ProtectionStorage.hasProof(conn, caseRow.id, "arrival");
      ready = hasArrival && !!caseRow.client_confirmed_at;
    }
    if (!ready) return caseRow;
    const started = await ProtectionStorage.startWindow(conn, caseRow.id, WINDOW_DAYS);
    return started || caseRow;
  }

  /**
   * CDC: cases cuja janela de 7d venceu sem disputa → clear → arma o ledger.
   * Chamado pelo agendador (index.js).
   */
  static async processWindows() {
    return runWithLogs(log, "processWindows", () => ({}), async () => {
      const due = await ProtectionStorage.clearDueWindows(pool, 50);
      let armed = 0;
      for (const row of due) {
        try {
          const r = await ProtectionService.armLedger(row);
          if (r?.armed) armed++;
        } catch (err) {
          log.error("arm.fail", { case_id: row.id, domain: row.domain, ref_id: String(row.ref_id), message: err.message });
        }
      }
      return { cleared: due.length, armed };
    });
  }

  /**
   * Arma o ledger (seller_balance / booking_payout) com holdback de 8 dias a
   * partir do cleared_at. Idempotente — UNIQUE em id_order/id_booking impede
   * duplicar.
   */
  static async armLedger(caseRow) {
    if (!caseRow) return { skipped: true };
    const available_at = plusDays(caseRow.cleared_at, HOLDBACK_DAYS);

    if (caseRow.domain === "product") {
      const order = await ProfileProductOrderStorage.getById(pool, caseRow.ref_id);
      if (!order) return { error: "order_not_found" };
      const created = await SellerBalanceStorage.create(pool, {
        id_seller_user: order.id_seller_user,
        id_seller_profile: order.id_seller_profile,
        id_order: order.id_order,
        gross_cents: Number(order.total_cents) || 0,
        platform_fee_cents: Number(order.service_fee_cents) || 0,
        shipping_cents: Number(order.shipping_cents) || 0,
        net_cents: Number(order.seller_amount_cents) || 0,
        status: "aguardando",
        available_at,
        protection_case_id: caseRow.id,
      });
      return { armed: !!created, balance: created };
    }

    if (caseRow.domain === "booking") {
      const r = await pool.query(
        `SELECT * FROM public.tb_profile_bookings WHERE id = $1 LIMIT 1`,
        [caseRow.ref_id]
      );
      const booking = r.rows[0];
      if (!booking) return { error: "booking_not_found" };
      const professional = Number(booking.professional_amount) || 0;
      if (professional <= 0) return { skipped: true };
      const created = await BookingPayoutStorage.create(pool, {
        id_booking: booking.id,
        id_profile: booking.id_profile,
        id_owner_user: booking.profile_owner_user_id,
        id_profile_service: booking.id_profile_service || null,
        client_name: booking.client_name,
        client_email: booking.client_email,
        client_whatsapp: booking.client_whatsapp,
        deposit_cents: Number(booking.deposit_amount) || 0,
        platform_fee_cents: Number(booking.platform_fee_amount) || 0,
        professional_cents: professional,
        net_cents: professional,
        status: "aguardando",
        available_at,
        booking_date: booking.booking_date,
        booking_start_time: booking.start_time,
        protection_case_id: caseRow.id,
      });
      return { armed: !!created, payout: created };
    }

    return { skipped: true };
  }
}

ProtectionService.WINDOW_DAYS = WINDOW_DAYS;
ProtectionService.HOLDBACK_DAYS = HOLDBACK_DAYS;

module.exports = ProtectionService;
