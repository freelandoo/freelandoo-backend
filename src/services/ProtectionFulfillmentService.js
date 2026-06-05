const pool = require("../databases");
const ProtectionStorage = require("../storages/ProtectionStorage");
const ProtectionService = require("./ProtectionService");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const uploadProtectionMedia = require("../integrations/r2/uploadProtectionMedia");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProtectionFulfillmentService");

const PAID_ORDER_STATES = new Set(["paid", "shipped", "delivered"]);
const ACTIVE_BOOKING_STATES = new Set(["confirmed", "completed"]);

class ProtectionFulfillmentService {
  /**
   * Lojista confirma a postagem (foto + rastreio ME já existente). Inicia o
   * relógio de disputa (7d) do pedido.
   */
  static async submitShipmentProof(user, id_order, file) {
    return runWithLogs(log, "submitShipmentProof", () => ({ id_user: user?.id_user, id_order }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", status: 401 };
      if (!file) return { error: "Foto da postagem é obrigatória" };

      const order = await ProfileProductOrderStorage.getForSeller(pool, Number(id_order), user.id_user);
      if (!order) return { error: "Pedido não encontrado" };
      if (!PAID_ORDER_STATES.has(order.status)) return { error: "Pedido não está pago" };
      if (!order.melhor_envio_order_id && !order.tracking_code) {
        return { error: "Etiqueta ainda sendo gerada — tente novamente em instantes." };
      }

      const caseRow = await ProtectionStorage.openCase(pool, { domain: "product", ref_id: order.id_order });
      const { url } = await uploadProtectionMedia({ prefix: "fulfillment-proof", id: caseRow.id, file });

      await ProtectionStorage.recordProof(pool, {
        protection_case_id: caseRow.id,
        kind: "shipment",
        photo_url: url,
        tracking_code: order.tracking_code || null,
        created_by_user_id: user.id_user,
      });
      await ProfileProductOrderStorage.markShipped(pool, order.id_order);

      const updated = await ProtectionService.maybeStartWindow(pool, caseRow);
      return { ok: true, case: updated, tracking_code: order.tracking_code || null, proof_url: url };
    });
  }

  /**
   * Prestador anexa prova de chegada/início ou de conclusão de um agendamento.
   */
  static async submitBookingProof(user, id_booking, kind, file) {
    return runWithLogs(log, "submitBookingProof", () => ({ id_user: user?.id_user, id_booking, kind }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", status: 401 };
      if (kind !== "arrival" && kind !== "completion") return { error: "kind inválido" };
      if (!file) return { error: "Foto é obrigatória" };

      const r = await pool.query(
        `SELECT * FROM public.tb_profile_bookings WHERE id = $1 AND profile_owner_user_id = $2 LIMIT 1`,
        [Number(id_booking), user.id_user]
      );
      const booking = r.rows[0];
      if (!booking) return { error: "Agendamento não encontrado" };
      if (booking.payment_status !== "paid" || !ACTIVE_BOOKING_STATES.has(booking.status)) {
        return { error: "Agendamento não está pago/confirmado" };
      }

      const caseRow = await ProtectionStorage.openCase(pool, { domain: "booking", ref_id: booking.id });
      const { url } = await uploadProtectionMedia({ prefix: "fulfillment-proof", id: caseRow.id, file });

      await ProtectionStorage.recordProof(pool, {
        protection_case_id: caseRow.id,
        kind,
        photo_url: url,
        created_by_user_id: user.id_user,
      });

      // Só a chegada (+ confirmação do cliente) dispara a janela; conclusão é prova extra.
      const fresh = await ProtectionStorage.getCaseById(pool, caseRow.id);
      const updated = await ProtectionService.maybeStartWindow(pool, fresh);
      return { ok: true, case: updated, proof_url: url };
    });
  }

  /**
   * Cliente confirma que o prestador chegou/serviço ocorreu. Casa pelo e-mail do
   * booking (cliente pode não ter conta vinculada).
   */
  static async confirmBookingArrival(user, id_booking) {
    return runWithLogs(log, "confirmBookingArrival", () => ({ id_user: user?.id_user, id_booking }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", status: 401 };

      const r = await pool.query(
        `SELECT b.* FROM public.tb_profile_bookings b
          WHERE b.id = $1
            AND lower(b.client_email) = (SELECT lower(email) FROM public.tb_user WHERE id_user = $2)
          LIMIT 1`,
        [Number(id_booking), user.id_user]
      );
      const booking = r.rows[0];
      if (!booking) return { error: "Agendamento não encontrado para este cliente" };

      const caseRow = await ProtectionStorage.openCase(pool, { domain: "booking", ref_id: booking.id });
      await ProtectionStorage.setClientConfirmed(pool, caseRow.id);

      const fresh = await ProtectionStorage.getCaseById(pool, caseRow.id);
      const updated = await ProtectionService.maybeStartWindow(pool, fresh);
      return { ok: true, case: updated };
    });
  }

  /** Status da proteção (caso + provas) para exibição. */
  static async getStatus(domain, ref_id) {
    const caseRow = await ProtectionStorage.getCase(pool, { domain, ref_id: Number(ref_id) });
    if (!caseRow) return { case: null, proofs: [] };
    const proofs = await ProtectionStorage.listProofs(pool, caseRow.id);
    return { case: caseRow, proofs };
  }
}

module.exports = ProtectionFulfillmentService;
