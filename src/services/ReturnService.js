const pool = require("../databases");
const ReturnStorage = require("../storages/ReturnStorage");
const DisputeStorage = require("../storages/DisputeStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const { purchaseReverseLabel } = require("../integrations/melhorenvio/purchaseReverseLabel");
const { trackShipment } = require("../integrations/melhorenvio/trackShipment");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ReturnService");

class ReturnService {
  /** Cria a devolução p/ a disputa e dispara a compra da etiqueta reversa. */
  static async initReturn(dispute, ref) {
    return runWithLogs(log, "initReturn", () => ({ dispute_id: dispute?.id }), async () => {
      if (!dispute || dispute.domain !== "product") return { skipped: true };
      const ret = await ReturnStorage.create(pool, { dispute_id: dispute.id });
      // Compra em background — falha cai no job de retry.
      setImmediate(() => {
        ReturnService.purchaseReverseForReturn(ret.id).catch((err) => {
          log.warn("reverse.dispatch_fail", { return_id: ret.id, message: err.message });
        });
      });
      return { return: ret };
    });
  }

  static async purchaseReverseForReturn(return_id) {
    return runWithLogs(log, "purchaseReverseForReturn", () => ({ return_id }), async () => {
      const ret = await ReturnStorage.getById(pool, return_id);
      if (!ret) return { error: "Devolução não encontrada" };
      if (ret.me_reverse_order_id && ret.purchased_at) return { already: true, return: ret };

      const dispute = await DisputeStorage.getById(pool, ret.dispute_id);
      if (!dispute) return { error: "Disputa não encontrada" };
      const order = await ProfileProductOrderStorage.getById(pool, dispute.ref_id);
      if (!order) {
        await ReturnStorage.markFailure(pool, return_id, "Pedido não encontrado");
        return { error: "Pedido não encontrado" };
      }
      const product = await ProfileProductStorage.getWithOwner(pool, order.id_profile_product);
      if (!product) {
        await ReturnStorage.markFailure(pool, return_id, "Produto não encontrado");
        return { error: "Produto não encontrado" };
      }
      const sellerRow = await pool.query(
        `SELECT nome, email, telefone FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
        [order.id_seller_user]
      );
      const seller = sellerRow.rows[0] || {};

      try {
        const result = await purchaseReverseLabel({
          order,
          product,
          seller: {
            nome: seller.nome,
            email: seller.email,
            telefone: seller.telefone,
            origin_zipcode: product.origin_zipcode_override || product.profile_origin_zipcode,
          },
        });
        const updated = await ReturnStorage.markPurchased(pool, return_id, result);
        log.info("reverse.purchased", { return_id, me_reverse_order_id: result.me_reverse_order_id });
        return { return: updated, ...result };
      } catch (err) {
        await ReturnStorage.markFailure(pool, return_id, err.message || "Falha desconhecida");
        log.warn("reverse.purchase_fail", { return_id, message: err.message });
        return { error: err.message };
      }
    });
  }

  /** CDC: retry da compra de etiquetas reversas pendentes/erro. */
  static async processPendingReverse() {
    return runWithLogs(log, "processPendingReverse", () => ({}), async () => {
      const ids = await ReturnStorage.listPendingPurchase(pool, { limit: 20 });
      let ok = 0, fail = 0;
      for (const id of ids) {
        const r = await ReturnService.purchaseReverseForReturn(id);
        if (r.error) fail++; else ok++;
      }
      return { processed: ids.length, ok, fail };
    });
  }

  /**
   * CDC: rastreia devoluções em trânsito. Ao detectar ENTREGUE na origem,
   * marca delivered_origin e dispara o reembolso (DisputeService.systemRefund).
   */
  static async tickTracking() {
    return runWithLogs(log, "tickTracking", () => ({}), async () => {
      const rows = await ReturnStorage.listTrackable(pool, { limit: 50 });
      let delivered = 0;
      for (const row of rows) {
        try {
          const t = await trackShipment(row.me_reverse_order_id);
          if (!t.normalized) continue;
          if (t.normalized === "delivered_origin") {
            const ret = await ReturnStorage.updateStatus(pool, row.id, "delivered_origin", { tracking_code: t.tracking, delivered: true, posted: true });
            const DisputeService = require("./DisputeService");
            await DisputeService.systemRefund(ret.dispute_id, "Devolução recebida na origem (rastreio reverso)");
            delivered++;
          } else if (t.normalized === "in_transit" || t.normalized === "posted") {
            await ReturnStorage.updateStatus(pool, row.id, t.normalized, { tracking_code: t.tracking, posted: t.normalized === "posted" });
          }
        } catch (err) {
          log.warn("track.fail", { return_id: row.id, message: err.message });
        }
      }
      return { tracked: rows.length, delivered };
    });
  }

  /**
   * CDC: disputas "não chegou" escaladas há > 10 dias. Consulta o rastreio de
   * IDA: se NÃO foi entregue, reembolsa automaticamente; se foi entregue, deixa
   * para o admin decidir (a alegação contradiz o rastreio).
   */
  static async processNotArrived() {
    return runWithLogs(log, "processNotArrived", () => ({}), async () => {
      const DisputeService = require("./DisputeService");
      const stale = await DisputeStorage.listStaleNotArrived(pool, { days: 10, limit: 30 });
      let refunded = 0;
      for (const d of stale) {
        try {
          const order = await ProfileProductOrderStorage.getById(pool, d.ref_id);
          if (!order?.melhor_envio_order_id) {
            await DisputeService.systemRefund(d.id, "Produto não chegou (sem rastreio) — reembolso automático");
            refunded++;
            continue;
          }
          const t = await trackShipment(order.melhor_envio_order_id);
          if (t.normalized === "delivered_origin") continue; // ida entregue → admin decide
          await DisputeService.systemRefund(d.id, "Produto não chegou no prazo (rastreio de ida sem entrega) — reembolso automático");
          refunded++;
        } catch (err) {
          log.warn("not_arrived.check_fail", { dispute_id: d.id, message: err.message });
        }
      }
      return { stale: stale.length, refunded };
    });
  }
}

module.exports = ReturnService;
