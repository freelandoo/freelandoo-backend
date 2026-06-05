/**
 * ProtectionTestService — harness TEMPORÁRIO para simular o fluxo de Proteção de
 * Pagamento (Loja) ponta-a-ponta com o MESMO usuário como comprador e vendedor,
 * sem Stripe/Melhor Envio reais e sem esperar os prazos (7d janela, 8d holdback).
 *
 * Tudo é marcado com stripe_session_id começando em 'TEST-' e pode ser apagado
 * pelo endpoint de limpeza. Gateado por admin + env ENABLE_PROTECTION_TEST.
 */
const pool = require("../databases");
const ProtectionStorage = require("../storages/ProtectionStorage");
const ProtectionService = require("./ProtectionService");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const DisputeStorage = require("../storages/DisputeStorage");
const DisputeService = require("./DisputeService");
const ReturnStorage = require("../storages/ReturnStorage");
const SellerBalanceStorage = require("../storages/SellerBalanceStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProtectionTestService");

function isEnabled() {
  return process.env.ENABLE_PROTECTION_TEST !== "false";
}

class ProtectionTestService {
  static enabled() { return isEnabled(); }

  /** Produtos do próprio usuário (para escolher qual "comprar de si mesmo"). */
  static async myProducts(user) {
    return runWithLogs(log, "myProducts", () => ({ id_user: user?.id_user }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const r = await pool.query(
        `SELECT pp.id_profile_product, pp.name, pp.price_amount, pp.stock_quantity,
                pr.id_profile, pr.display_name
           FROM public.tb_profile_product pp
           JOIN public.tb_profile pr ON pr.id_profile = pp.id_profile
          WHERE pr.id_user = $1 AND pp.is_active = TRUE AND pp.deleted_at IS NULL
          ORDER BY pp.created_at DESC LIMIT 50`,
        [user.id_user]
      );
      return { products: r.rows };
    });
  }

  /** Cria um pedido pago de teste (comprador = vendedor = usuário atual). */
  static async seed(user, id_profile_product) {
    return runWithLogs(log, "seed", () => ({ id_user: user?.id_user, id_profile_product }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const product = await ProfileProductStorage.getWithOwner(pool, Number(id_profile_product));
      if (!product) return { error: "Produto não encontrado" };

      const u = await pool.query(`SELECT nome, email FROM public.tb_user WHERE id_user = $1`, [user.id_user]);
      const me = u.rows[0] || {};

      const unit = Number(product.price_amount) || 1000;
      const shipping = 1500;
      const return_shipping = 1500;
      const total = unit + shipping + return_shipping;

      const order = await ProfileProductOrderStorage.create(pool, {
        id_buyer_user: user.id_user,
        id_profile_product: Number(id_profile_product),
        id_seller_profile: product.id_profile,
        id_seller_user: product.owner_id_user,
        quantity: 1,
        unit_price_cents: unit,
        shipping_cents: shipping,
        return_shipping_cents: return_shipping,
        total_cents: total,
        seller_amount_cents: unit,
        service_fee_cents: 0,
        processor_fee_cents: 0,
        processor_fee_source: "fallback",
        shipping_service_id: "TEST",
        shipping_service_name: "Teste",
        shipping_carrier: "Teste",
        destination_zipcode: "01001000",
        destination_full_address: { cep: "01001000", street: "Praça da Sé", number: "1", neighborhood: "Sé", city: "São Paulo", uf: "SP" },
        buyer_name: me.nome || "Comprador Teste",
        buyer_email: me.email || "teste@freelandoo.com",
        buyer_whatsapp: "11999999999",
        stripe_session_id: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: "paid",
      });
      await pool.query(`UPDATE public.tb_profile_product_order SET paid_at = NOW() WHERE id_order = $1`, [order.id_order]);

      await ProtectionService.openCase(pool, { domain: "product", ref_id: order.id_order });
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Simula a postagem (sem upload): grava prova + rastreio fake + inicia janela. */
  static async simulateShipment(user, order_id) {
    return runWithLogs(log, "simulateShipment", () => ({ order_id }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const order = await ProtectionTestService.ownTestOrder(user, order_id);
      if (order.error) return order;
      await ProfileProductOrderStorage.markLabelPurchased(pool, order.id_order, {
        melhor_envio_order_id: `TEST-ME-${order.id_order}`,
        label_pdf_url: "https://example.com/etiqueta-teste.pdf",
        tracking_code: `TESTBR${order.id_order}`,
      });
      await ProfileProductOrderStorage.markShipped(pool, order.id_order);
      const caseRow = await ProtectionStorage.getCase(pool, { domain: "product", ref_id: order.id_order });
      await ProtectionStorage.recordProof(pool, {
        protection_case_id: caseRow.id, kind: "shipment",
        photo_url: "https://example.com/postagem-teste.jpg",
        tracking_code: `TESTBR${order.id_order}`, created_by_user_id: user.id_user,
      });
      await ProtectionService.maybeStartWindow(pool, caseRow);
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Pula a janela de 7d: clear + arma o ledger. */
  static async advanceWindow(user, order_id) {
    return runWithLogs(log, "advanceWindow", () => ({ order_id }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const order = await ProtectionTestService.ownTestOrder(user, order_id);
      if (order.error) return order;
      const caseRow = await ProtectionStorage.getCase(pool, { domain: "product", ref_id: order.id_order });
      if (!caseRow) return { error: "Caso não encontrado" };
      await pool.query(
        `UPDATE public.tb_protection_case SET window_ends_at = NOW() - INTERVAL '1 second'
          WHERE id = $1 AND state = 'dispute_window'`,
        [caseRow.id]
      );
      await ProtectionService.processWindows();
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Abre disputa como comprador (fluxo REAL de roteamento). */
  static async openDispute(user, order_id, reason_code, description) {
    return runWithLogs(log, "openDispute", () => ({ order_id, reason_code }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const order = await ProtectionTestService.ownTestOrder(user, order_id);
      if (order.error) return order;
      const r = await DisputeService.openDispute(user, {
        domain: "product", ref_id: order.id_order, reason_code, description: description || "Disputa de teste",
      }, []);
      if (r.error) return r;
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Simula a devolução chegando na origem → reembolso (parcial, retém reverso). */
  static async simulateReverseDelivered(user, order_id) {
    return runWithLogs(log, "simulateReverseDelivered", () => ({ order_id }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const order = await ProtectionTestService.ownTestOrder(user, order_id);
      if (order.error) return order;
      const caseRow = await ProtectionStorage.getCase(pool, { domain: "product", ref_id: order.id_order });
      const dispute = await DisputeStorage.getActiveByCase(pool, caseRow.id);
      if (!dispute) return { error: "Nenhuma disputa ativa para devolver" };
      const ret = await ReturnStorage.getByDispute(pool, dispute.id);
      if (ret) await ReturnStorage.updateStatus(pool, ret.id, "delivered_origin", { delivered: true, posted: true });
      await DisputeService.systemRefund(dispute.id, "[TESTE] Devolução recebida na origem");
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Força o desfecho do "não chegou" escalado (reembolso automático). */
  static async simulateNotArrivedRefund(user, order_id) {
    return runWithLogs(log, "simulateNotArrivedRefund", () => ({ order_id }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const order = await ProtectionTestService.ownTestOrder(user, order_id);
      if (order.error) return order;
      const caseRow = await ProtectionStorage.getCase(pool, { domain: "product", ref_id: order.id_order });
      const dispute = await DisputeStorage.getActiveByCase(pool, caseRow.id);
      if (!dispute) return { error: "Nenhuma disputa ativa" };
      await DisputeService.systemRefund(dispute.id, "[TESTE] Não chegou no prazo — reembolso automático");
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Resolução do admin (refund | release). */
  static async adminResolve(user, order_id, action, note) {
    return runWithLogs(log, "adminResolve", () => ({ order_id, action }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const order = await ProtectionTestService.ownTestOrder(user, order_id);
      if (order.error) return order;
      const caseRow = await ProtectionStorage.getCase(pool, { domain: "product", ref_id: order.id_order });
      const dispute = await DisputeStorage.getActiveByCase(pool, caseRow.id);
      if (!dispute) return { error: "Nenhuma disputa ativa" };
      const r = await DisputeService.resolveByAdmin(user, dispute.id, { action, note: note || "[TESTE] decisão admin" });
      if (r.error) return r;
      return ProtectionTestService.getState(user, order.id_order);
    });
  }

  /** Dump completo do estado para a UI desenhar o passo-a-passo. */
  static async getState(user, order_id) {
    if (!isEnabled()) return { error: "Modo de teste desativado" };
    const order = await ProtectionTestService.ownTestOrder(user, order_id);
    if (order.error) return order;
    const caseRow = await ProtectionStorage.getCase(pool, { domain: "product", ref_id: order.id_order });
    const proofs = caseRow ? await ProtectionStorage.listProofs(pool, caseRow.id) : [];
    let dispute = null, evidence = [], ret = null;
    if (caseRow) {
      const d = await pool.query(`SELECT * FROM public.tb_dispute WHERE protection_case_id = $1 ORDER BY created_at DESC LIMIT 1`, [caseRow.id]);
      dispute = d.rows[0] || null;
      if (dispute) {
        evidence = await DisputeStorage.listEvidence(pool, dispute.id);
        ret = await ReturnStorage.getByDispute(pool, dispute.id);
      }
    }
    const balance = await SellerBalanceStorage.getByOrder(pool, order.id_order);
    return { ok: true, order, case: caseRow, proofs, dispute, evidence, return: ret, balance };
  }

  /** Apaga todos os dados de teste do usuário (orders TEST- + cascatas). */
  static async cleanup(user) {
    return runWithLogs(log, "cleanup", () => ({ id_user: user?.id_user }), async () => {
      if (!isEnabled()) return { error: "Modo de teste desativado" };
      const orders = await pool.query(
        `SELECT id_order FROM public.tb_profile_product_order
          WHERE id_buyer_user = $1 AND stripe_session_id LIKE 'TEST-%'`,
        [user.id_user]
      );
      const ids = orders.rows.map((r) => r.id_order);
      let removed = 0;
      for (const id of ids) {
        // tb_dispute/tb_return/tb_fulfillment_proof caem por ON DELETE CASCADE do caso.
        await pool.query(`DELETE FROM public.tb_seller_balance WHERE id_order = $1`, [id]);
        await pool.query(`DELETE FROM public.tb_protection_case WHERE domain = 'product' AND ref_id = $1`, [id]);
        await pool.query(`DELETE FROM public.tb_profile_product_order WHERE id_order = $1`, [id]);
        removed++;
      }
      return { ok: true, removed };
    });
  }

  /** Garante que o pedido é do usuário e é de teste. */
  static async ownTestOrder(user, order_id) {
    const order = await ProfileProductOrderStorage.getById(pool, Number(order_id));
    if (!order) return { error: "Pedido não encontrado" };
    if (String(order.id_buyer_user) !== String(user.id_user)) return { error: "Pedido não é seu" };
    if (!String(order.stripe_session_id || "").startsWith("TEST-")) return { error: "Não é um pedido de teste" };
    return order;
  }
}

module.exports = ProtectionTestService;
