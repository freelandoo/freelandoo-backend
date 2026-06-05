const pool = require("../databases");
const DisputeStorage = require("../storages/DisputeStorage");
const ProtectionStorage = require("../storages/ProtectionStorage");
const ProtectionService = require("./ProtectionService");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const StripeService = require("./StripeService");
const uploadProtectionMedia = require("../integrations/r2/uploadProtectionMedia");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("DisputeService");

// Quais motivos são válidos por domínio.
const PRODUCT_REASONS = new Set(["product_not_arrived", "product_wrong", "product_defective", "scam", "other"]);
const BOOKING_REASONS = new Set(["service_no_show", "scam", "other"]);
// Motivos que podem ser abertos mesmo antes da prova (item nunca cumprido).
const PRE_PROOF_REASONS = new Set(["product_not_arrived", "service_no_show"]);
// Motivos que exigem devolução física (logística reversa — Slice 4).
const RETURN_REASONS = new Set(["product_wrong", "product_defective"]);

class DisputeService {
  /** Carrega order/booking + valida que o solicitante é o comprador/cliente. */
  static async loadRefForBuyer(domain, ref_id, user) {
    if (domain === "product") {
      const order = await ProfileProductOrderStorage.getById(pool, Number(ref_id));
      if (!order) return { error: "Pedido não encontrado" };
      if (String(order.id_buyer_user) !== String(user.id_user)) return { error: "Pedido não encontrado" };
      return { order };
    }
    if (domain === "booking") {
      const r = await pool.query(
        `SELECT b.* FROM public.tb_profile_bookings b
          WHERE b.id = $1
            AND lower(b.client_email) = (SELECT lower(email) FROM public.tb_user WHERE id_user = $2)
          LIMIT 1`,
        [Number(ref_id), user.id_user]
      );
      if (!r.rows[0]) return { error: "Agendamento não encontrado" };
      return { booking: r.rows[0] };
    }
    return { error: "domain inválido" };
  }

  /** Abre uma disputa e aplica as regras automáticas de roteamento. */
  static async openDispute(user, body, files = []) {
    return runWithLogs(log, "openDispute", () => ({ id_user: user?.id_user, domain: body?.domain, reason: body?.reason_code }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", status: 401 };
      const domain = String(body?.domain || "").trim();
      const ref_id = Number(body?.ref_id);
      const reason_code = String(body?.reason_code || "").trim();
      const description = body?.description ? String(body.description).slice(0, 2000) : null;

      if (domain !== "product" && domain !== "booking") return { error: "domain inválido" };
      if (!Number.isFinite(ref_id)) return { error: "ref_id inválido" };
      if (!DisputeStorage.REASON_CODES.has(reason_code)) return { error: "reason_code inválido" };
      const allowed = domain === "product" ? PRODUCT_REASONS : BOOKING_REASONS;
      if (!allowed.has(reason_code)) return { error: "Motivo não se aplica a este tipo" };

      const ref = await DisputeService.loadRefForBuyer(domain, ref_id, user);
      if (ref.error) return ref;

      const caseRow = await ProtectionStorage.getCase(pool, { domain, ref_id });
      if (!caseRow) return { error: "Proteção não encontrada para esta compra" };

      // Janela: só dentro do prazo de 7d; exceção para "não chegou/não apareceu"
      // que pode ser aberto enquanto o caso aguarda a prova de fulfillment.
      const inWindow = caseRow.state === "dispute_window";
      const prePhase = caseRow.state === "awaiting_fulfillment" && PRE_PROOF_REASONS.has(reason_code);
      if (!inWindow && !prePhase) {
        if (caseRow.state === "disputed") return { error: "Já existe uma disputa em andamento" };
        return { error: "Fora do prazo de disputa" };
      }

      const active = await DisputeStorage.getActiveByCase(pool, caseRow.id);
      if (active) return { error: "Já existe uma disputa em andamento" };

      const dispute = await DisputeStorage.create(pool, {
        protection_case_id: caseRow.id,
        domain, ref_id, opened_by_user_id: user.id_user, reason_code, description,
      });
      await ProtectionStorage.markDisputed(pool, caseRow.id, dispute.id);

      // Evidências do comprador (fotos).
      for (const file of files || []) {
        try {
          const { url } = await uploadProtectionMedia({ prefix: "dispute-evidence", id: dispute.id, file });
          await DisputeStorage.addEvidence(pool, {
            dispute_id: dispute.id, uploaded_by_user_id: user.id_user, role: "buyer", photo_url: url,
          });
        } catch (err) {
          log.warn("evidence.upload_fail", { dispute_id: dispute.id, message: err.message });
        }
      }

      const routed = await DisputeService.route(dispute, ref, caseRow);
      return { ok: true, dispute: routed };
    });
  }

  /** Regras automáticas de roteamento (admin só no limite). */
  static async route(dispute, ref, caseRow) {
    const { reason_code } = dispute;

    if (RETURN_REASONS.has(reason_code)) {
      // Produto errado/defeituoso → devolução física (Slice 4 compra a etiqueta).
      const updated = await DisputeStorage.updateState(pool, dispute.id, "awaiting_return");
      try {
        const ReturnService = require("./ReturnService");
        await ReturnService.initReturn(updated || dispute, ref);
      } catch (err) {
        log.warn("return.init_skip", { dispute_id: dispute.id, message: err.message });
      }
      return updated || dispute;
    }

    if (reason_code === "product_not_arrived") {
      const order = ref.order || {};
      const neverShipped = !order.tracking_code && !order.melhor_envio_order_id;
      if (neverShipped) return DisputeService.autoRefund(dispute, ref, caseRow, "Pedido não chegou e não há postagem registrada");
      return DisputeService.escalate(dispute, "Produto consta postado — requer análise do rastreio");
    }

    if (reason_code === "service_no_show") {
      const hasArrival = await ProtectionStorage.hasProof(pool, caseRow.id, "arrival");
      if (!hasArrival) return DisputeService.autoRefund(dispute, ref, caseRow, "Prestador não anexou prova de chegada");
      return DisputeService.escalate(dispute, "Há prova de chegada — requer análise");
    }

    // scam / other
    return DisputeService.escalate(dispute, "Caso requer análise do admin");
  }

  static async escalate(dispute, note) {
    const updated = await DisputeStorage.updateState(pool, dispute.id, "escalated_admin", { resolution_note: note });
    return updated || dispute;
  }

  /** Resolve o charge no Stripe para o ref da disputa. Idempotente/tolerante. */
  static async fireStripeRefund(domain, ref) {
    let charge_id = null;
    if (domain === "product") {
      charge_id = ref.order?.stripe_charge_id || null;
      if (!charge_id && ref.order?.stripe_payment_intent_id) {
        charge_id = await DisputeService.chargeFromPI(ref.order.stripe_payment_intent_id);
      }
    } else if (domain === "booking") {
      if (ref.booking?.stripe_payment_intent_id) {
        charge_id = await DisputeService.chargeFromPI(ref.booking.stripe_payment_intent_id);
      }
    }
    if (!charge_id) return { error: "Cobrança não localizada para reembolso" };
    try {
      await StripeService.createRefund(charge_id);
      return { ok: true, charge_id };
    } catch (err) {
      // Já reembolsado conta como sucesso (idempotência).
      const msg = String(err?.message || "").toLowerCase();
      if (msg.includes("already refunded") || msg.includes("has already been refunded")) return { ok: true, charge_id, already: true };
      log.error("refund.fail", { charge_id, message: err.message });
      return { error: "Falha ao reembolsar no Stripe" };
    }
  }

  static async chargeFromPI(piId) {
    try {
      const stripe = StripeService.client();
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
      return typeof pi.latest_charge === "object" ? pi.latest_charge?.id : pi.latest_charge || null;
    } catch (err) {
      log.warn("pi_lookup.fail", { piId, message: err.message });
      return null;
    }
  }

  /** Reembolsa o comprador (system ou admin) e fecha a disputa + caso. */
  static async autoRefund(dispute, ref, caseRow, note, resolved_by = "system") {
    const refund = await DisputeService.fireStripeRefund(dispute.domain, ref);
    if (refund.error) {
      // Não conseguiu reembolsar automaticamente → sobe pro admin.
      return DisputeService.escalate(dispute, `${note} — falha no reembolso automático, requer admin`);
    }
    const updated = await DisputeStorage.updateState(pool, dispute.id, "resolved_refund", { resolved_by, resolution_note: note });
    await ProtectionStorage.markRefunded(pool, caseRow.id);
    log.info("dispute.refunded", { dispute_id: dispute.id, resolved_by, charge_id: refund.charge_id });
    return updated || dispute;
  }

  /**
   * Reembolso disparado pelo sistema (ex.: devolução recebida na origem).
   * Idempotente — no-op se a disputa já está resolvida.
   */
  static async systemRefund(dispute_id, note) {
    return runWithLogs(log, "systemRefund", () => ({ dispute_id }), async () => {
      const dispute = await DisputeStorage.getById(pool, Number(dispute_id));
      if (!dispute) return { error: "Disputa não encontrada" };
      if (dispute.state === "resolved_refund" || dispute.state === "resolved_release") {
        return { already: true };
      }
      const caseRow = await ProtectionStorage.getCaseById(pool, dispute.protection_case_id);
      const ref = dispute.domain === "product"
        ? { order: await ProfileProductOrderStorage.getById(pool, dispute.ref_id) }
        : { booking: (await pool.query(`SELECT * FROM public.tb_profile_bookings WHERE id = $1`, [dispute.ref_id])).rows[0] };
      const updated = await DisputeService.autoRefund(dispute, ref, caseRow, note || "Reembolso automático", "system");
      return { ok: true, dispute: updated };
    });
  }

  /** Resolução do admin. */
  static async resolveByAdmin(adminUser, dispute_id, { action, note }) {
    return runWithLogs(log, "resolveByAdmin", () => ({ admin: adminUser?.id_user, dispute_id, action }), async () => {
      const dispute = await DisputeStorage.getById(pool, Number(dispute_id));
      if (!dispute) return { error: "Disputa não encontrada" };
      if (dispute.state === "resolved_refund" || dispute.state === "resolved_release") {
        return { error: "Disputa já resolvida" };
      }
      const caseRow = await ProtectionStorage.getCaseById(pool, dispute.protection_case_id);

      if (action === "refund") {
        const ref = dispute.domain === "product"
          ? { order: await ProfileProductOrderStorage.getById(pool, dispute.ref_id) }
          : { booking: (await pool.query(`SELECT * FROM public.tb_profile_bookings WHERE id = $1`, [dispute.ref_id])).rows[0] };
        const updated = await DisputeService.autoRefund(dispute, ref, caseRow, note || "Reembolso aprovado pelo admin", "admin");
        return { ok: true, dispute: updated };
      }

      if (action === "release") {
        const updated = await DisputeStorage.updateState(pool, dispute.id, "resolved_release", { resolved_by: "admin", resolution_note: note || "Liberado pelo admin" });
        const cleared = await ProtectionStorage.markClearFromDispute(pool, caseRow.id);
        try {
          await ProtectionService.armLedger(cleared || caseRow);
        } catch (err) {
          log.error("release.arm_fail", { case_id: caseRow.id, message: err.message });
        }
        return { ok: true, dispute: updated };
      }

      return { error: "Ação inválida (use refund ou release)" };
    });
  }

  // ── Leitura ────────────────────────────────────────────────────────────────
  static async getForUser(user, dispute_id) {
    return runWithLogs(log, "getForUser", () => ({ id_user: user?.id_user, dispute_id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", status: 401 };
      const dispute = await DisputeStorage.getById(pool, Number(dispute_id));
      if (!dispute) return { error: "Disputa não encontrada" };
      if (String(dispute.opened_by_user_id) !== String(user.id_user)) return { error: "Disputa não encontrada" };
      const evidence = await DisputeStorage.listEvidence(pool, dispute.id);
      let ret = null;
      try {
        const ReturnStorage = require("../storages/ReturnStorage");
        ret = await ReturnStorage.getByDispute(pool, dispute.id);
      } catch { /* Slice 4 ainda não disponível */ }
      return { dispute, evidence, return: ret };
    });
  }

  static async addEvidence(user, dispute_id, files = [], note) {
    return runWithLogs(log, "addEvidence", () => ({ id_user: user?.id_user, dispute_id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", status: 401 };
      const dispute = await DisputeStorage.getById(pool, Number(dispute_id));
      if (!dispute) return { error: "Disputa não encontrada" };

      // Define o papel: comprador (quem abriu), vendedor (dono do ref) ou admin.
      let role = null;
      if (String(dispute.opened_by_user_id) === String(user.id_user)) role = "buyer";
      else if (dispute.domain === "product") {
        const order = await ProfileProductOrderStorage.getById(pool, dispute.ref_id);
        if (order && String(order.id_seller_user) === String(user.id_user)) role = "seller";
      } else if (dispute.domain === "booking") {
        const r = await pool.query(`SELECT profile_owner_user_id FROM public.tb_profile_bookings WHERE id = $1`, [dispute.ref_id]);
        if (r.rows[0] && String(r.rows[0].profile_owner_user_id) === String(user.id_user)) role = "seller";
      }
      if (!role) return { error: "Sem permissão para anexar nesta disputa", status: 403 };

      const added = [];
      for (const file of files || []) {
        const { url } = await uploadProtectionMedia({ prefix: "dispute-evidence", id: dispute.id, file });
        const ev = await DisputeStorage.addEvidence(pool, {
          dispute_id: dispute.id, uploaded_by_user_id: user.id_user, role, photo_url: url, note: note || null,
        });
        added.push(ev);
      }
      return { ok: true, evidence: added };
    });
  }

  // ── Admin ────────────────────────────────────────────────────────────────
  static async listAdmin(query = {}) {
    return runWithLogs(log, "listAdmin", () => ({ state: query?.state }), async () => {
      const items = await DisputeStorage.listAdmin(pool, {
        state: query.state || null,
        domain: query.domain || null,
        q: query.q || null,
        limit: Math.min(Math.max(Number(query.limit) || 50, 1), 100),
        offset: Math.max(Number(query.offset) || 0, 0),
      });
      const counts = await DisputeStorage.countByState(pool);
      return { items, counts };
    });
  }

  static async getAdminDetail(dispute_id) {
    return runWithLogs(log, "getAdminDetail", () => ({ dispute_id }), async () => {
      const dispute = await DisputeStorage.getById(pool, Number(dispute_id));
      if (!dispute) return { error: "Disputa não encontrada" };
      const evidence = await DisputeStorage.listEvidence(pool, dispute.id);
      const caseRow = await ProtectionStorage.getCaseById(pool, dispute.protection_case_id);
      const proofs = await ProtectionStorage.listProofs(pool, dispute.protection_case_id);
      let ret = null;
      try {
        const ReturnStorage = require("../storages/ReturnStorage");
        ret = await ReturnStorage.getByDispute(pool, dispute.id);
      } catch { /* Slice 4 */ }
      let ref = null;
      if (dispute.domain === "product") {
        ref = await ProfileProductOrderStorage.getById(pool, dispute.ref_id);
      } else {
        ref = (await pool.query(`SELECT * FROM public.tb_profile_bookings WHERE id = $1`, [dispute.ref_id])).rows[0] || null;
      }
      return { dispute, evidence, case: caseRow, proofs, return: ret, ref };
    });
  }
}

DisputeService.RETURN_REASONS = RETURN_REASONS;

module.exports = DisputeService;
