const pool = require("../databases");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const SellerBalanceStorage = require("../storages/SellerBalanceStorage");
const ShippingService = require("./ShippingService");
const StripeService = require("./StripeService");
const StoreGovernanceService = require("./StoreGovernanceService");
const ProtectionService = require("./ProtectionService");
const { purchaseLabel } = require("../integrations/melhorenvio/purchaseLabel");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProfileProductOrderService");

const HOLDBACK_DAYS = 8;

function normalizeCep(z) {
  if (z == null) return null;
  const d = String(z).replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

function sanitizeText(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

class ProfileProductOrderService {
  /**
   * Cria order pending e devolve URL do Stripe Checkout.
   */
  static async createCheckout(user, body = {}) {
    return runWithLogs(log, "createCheckout", () => ({ id_user: user?.id_user, product_id: body?.id_profile_product }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };

      const id_profile_product = Number(body.id_profile_product);
      if (!id_profile_product) return { error: "Produto inválido" };

      const quantity = Math.max(1, Math.min(99, Number(body.quantity) || 1));
      const destCep = normalizeCep(body.destination_zipcode);
      if (!destCep) return { error: "CEP de destino inválido" };

      const shippingServiceId = body.shipping_service_id != null ? String(body.shipping_service_id) : null;
      if (!shippingServiceId) return { error: "Selecione uma opção de frete" };

      const buyer = {
        buyer_name: sanitizeText(body.buyer_name, 160),
        buyer_email: sanitizeText(body.buyer_email, 160),
        buyer_whatsapp: sanitizeText(body.buyer_whatsapp, 40),
      };
      if (!buyer.buyer_name) return { error: "Nome do comprador é obrigatório" };
      if (!buyer.buyer_email) return { error: "E-mail do comprador é obrigatório" };

      const destination_full_address = body.destination_full_address && typeof body.destination_full_address === "object"
        ? {
            cep: destCep,
            street: sanitizeText(body.destination_full_address.street, 160),
            number: sanitizeText(body.destination_full_address.number, 20),
            complement: sanitizeText(body.destination_full_address.complement, 120),
            neighborhood: sanitizeText(body.destination_full_address.neighborhood, 120),
            city: sanitizeText(body.destination_full_address.city, 120),
            uf: sanitizeText(body.destination_full_address.uf, 2),
          }
        : null;

      const product = await ProfileProductStorage.getWithOwner(pool, id_profile_product);
      if (!product || !product.is_active || product.deleted_at) {
        return { error: "Produto não encontrado" };
      }
      if (product.profile_is_clan) return { error: "Produto não encontrado" };
      if (!product.profile_is_paid) return { error: "Loja indisponível" };
      if (product.stock_quantity < quantity) return { error: "Estoque insuficiente" };

      // Recotação para evitar tampering. Aceita a opção selecionada por id.
      const quote = await ShippingService.quote({
        id_profile: product.id_profile,
        id_profile_product,
        destination_zipcode: destCep,
        quantity,
      });
      if (quote?.error) return { error: quote.error };
      const option = (quote.options || []).find((o) => String(o.service_id) === shippingServiceId);
      if (!option) return { error: "Opção de frete inválida ou expirada — recalcule" };

      const unit_seller = Number(product.price_amount) || 0;
      // Opt-in de afiliado por item (mig 090). Só quando ligado a comissão aditiva
      // é embutida no preço e o cupom passa a gerar conversão.
      const affiliatesAllowed = product.affiliates_allowed === true;
      const pricing = await StoreGovernanceService.computeFeesFor(unit_seller, { affiliatesAllowed });
      const unit_display = pricing.display_price_cents;
      const shipping_cents = option.price_cents;
      // Comprador paga: display_price (já inclui taxas) * qty + frete
      const total_cents = unit_display * quantity + shipping_cents;
      const seller_amount_total = unit_seller * quantity;
      const service_fee_total = pricing.service_fee_cents * quantity;
      const processor_fee_total = pricing.processor_fee_cents * quantity;
      // Comissão de afiliado embutida no display (sem frete) — total do pedido.
      const affiliate_commission_total = (pricing.affiliate_commission_cents || 0) * quantity;

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const successUrl = `${frontend}/account/compras?status=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${frontend}/p/${product.id_profile}/produto/${id_profile_product}?status=cancel`;

      const session = await StripeService.createMultiItemCheckoutSession({
        line_items: [
          { name: product.name, amount_cents: unit_display, quantity },
          { name: `Frete — ${option.carrier} ${option.service_name}`, amount_cents: shipping_cents, quantity: 1 },
        ],
        currency: "BRL",
        customerEmail: buyer.buyer_email,
        clientReferenceId: user.id_user,
        successUrl,
        cancelUrl,
        metadata: {
          type: "profile_product_order",
          id_profile_product: String(id_profile_product),
          id_buyer_user: String(user.id_user),
          quantity: String(quantity),
          // Comissão de afiliado SÓ quando o item tem opt-in: o cupom só gera
          // conversão se houver comissão embutida (gate real do affiliates_allowed).
          ...(affiliatesAllowed && body.coupon_code && affiliate_commission_total > 0
            ? {
                coupon_code: String(body.coupon_code).trim().toUpperCase().slice(0, 40),
                affiliate_commission_cents: String(affiliate_commission_total),
              }
            : {}),
        },
      });

      const order = await ProfileProductOrderStorage.create(pool, {
        id_buyer_user: user.id_user,
        id_profile_product,
        id_seller_profile: product.id_profile,
        id_seller_user: product.owner_id_user,
        quantity,
        unit_price_cents: unit_display,
        shipping_cents,
        total_cents,
        seller_amount_cents: seller_amount_total,
        service_fee_cents: service_fee_total,
        processor_fee_cents: processor_fee_total,
        processor_fee_source: "fallback",
        shipping_service_id: shippingServiceId,
        shipping_service_name: option.service_name,
        shipping_carrier: option.carrier,
        destination_zipcode: destCep,
        destination_full_address,
        ...buyer,
        stripe_session_id: session.id,
        status: "pending",
      });

      return { checkout_url: session.url, session_id: session.id, order };
    });
  }

  /**
   * Confirmação do webhook checkout.session.completed para orders da Loja.
   * Decrementa estoque, marca pago, cria saldo do vendedor com holdback.
   */
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "profile_product_order") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await ProfileProductOrderStorage.getByStripeSession(client, session.id);
      if (!existing) {
        await client.query("ROLLBACK");
        log.warn("confirm.order_not_found", { session_id: session.id });
        return { error: "order_not_found" };
      }
      if (existing.status === "paid" || existing.status === "shipped" ||
          existing.status === "delivered") {
        await client.query("COMMIT");
        return { order: existing, duplicate: true };
      }

      const payment_intent_id = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;
      // charge_id só fica disponível via PI; pode ser preenchido em charge.refunded.
      let charge_id = null;
      let stripe_fee_cents = null;
      if (payment_intent_id) {
        try {
          const stripe = StripeService.client();
          const pi = await stripe.paymentIntents.retrieve(payment_intent_id, {
            expand: ["latest_charge.balance_transaction"],
          });
          const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
          charge_id = charge?.id || (typeof pi.latest_charge === "string" ? pi.latest_charge : null);
          // balance_transaction.fee é o valor REAL cobrado pelo Stripe em centavos.
          const bt = charge?.balance_transaction;
          if (bt && typeof bt === "object" && Number.isFinite(bt.fee)) {
            stripe_fee_cents = Number(bt.fee);
          }
        } catch (err) {
          log.warn("confirm.pi_lookup_fail", { payment_intent_id, message: err.message });
        }
      }

      // Decrementa estoque atomicamente
      const decremented = await ProfileProductStorage.decrementStock(
        client,
        existing.id_profile_product,
        existing.quantity
      );

      if (!decremented) {
        // Estoque insuficiente na hora do webhook — cancela e dispara refund
        await ProfileProductOrderStorage.markCanceled(client, existing.id_order);
        await client.query("COMMIT");
        log.warn("confirm.out_of_stock_canceled", { id_order: existing.id_order });
        if (charge_id) {
          try { await StripeService.createRefund(charge_id); } catch (err) {
            log.error("confirm.refund_fail", { charge_id, message: err.message });
          }
        }
        return { error: "out_of_stock", canceled: true };
      }

      let paid = await ProfileProductOrderStorage.markPaid(client, existing.id_order, {
        payment_intent_id,
        charge_id,
      });

      // Substitui processor_fee estimado pela fee REAL do Stripe (balance_transaction.fee).
      // Vendedor recebe seller_amount_cents fixo; eventual diferença (estimado vs real)
      // é absorvida pela plataforma — service_fee_cents do order é o ganho bruto da plat.
      if (Number.isFinite(stripe_fee_cents) && stripe_fee_cents >= 0) {
        const updated = await ProfileProductOrderStorage.updateProcessorFeeFromStripe(
          client, paid.id_order, stripe_fee_cents
        );
        if (updated) paid = updated;
      }

      // Proteção de pagamento: NÃO cria mais o saldo do vendedor no pagamento.
      // Abre o caso de proteção (awaiting_fulfillment). O saldo só é armado quando
      // o lojista anexa a prova de postagem e a janela de 7d passa sem disputa
      // (ProtectionService.armLedger). Idempotente via UNIQUE(domain, ref_id).
      await ProtectionService.openCase(client, { domain: "product", ref_id: paid.id_order });

      await client.query("COMMIT");

      // Fire-and-forget: compra etiqueta no Melhor Envio. Falhas não bloqueiam
      // o webhook — vão pro job de retry.
      setImmediate(() => {
        ProfileProductOrderService.purchaseLabelForOrder(paid.id_order).catch((err) => {
          log.warn("confirm.label_dispatch_fail", { id_order: paid.id_order, message: err.message });
        });
      });

      return { order: paid };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Compra etiqueta no Melhor Envio para um pedido pago. Idempotente:
   * se já comprou, retorna {already:true}. Em falha, marca o erro e
   * incrementa attempts pra o job de retry pegar depois.
   */
  static async purchaseLabelForOrder(id_order) {
    return runWithLogs(log, "purchaseLabelForOrder", () => ({ id_order }), async () => {
      const order = await ProfileProductOrderStorage.getById(pool, id_order);
      if (!order) return { error: "Pedido não encontrado" };
      if (!["paid", "shipped", "delivered"].includes(order.status)) {
        return { error: "Pedido não está em status pagável" };
      }
      if (order.label_purchased_at && order.melhor_envio_order_id) {
        return {
          already: true,
          melhor_envio_order_id: order.melhor_envio_order_id,
          label_pdf_url: order.label_pdf_url,
        };
      }

      const product = await ProfileProductStorage.getWithOwner(pool, order.id_profile_product);
      if (!product) {
        await ProfileProductOrderStorage.markLabelFailure(pool, id_order, "Produto não encontrado para etiqueta");
        return { error: "Produto não encontrado" };
      }

      const sellerRow = await pool.query(
        `SELECT nome, email, telefone FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
        [order.id_seller_user]
      );
      const seller = sellerRow.rows[0] || {};

      try {
        const result = await purchaseLabel({
          order,
          product,
          seller: {
            nome: seller.nome,
            email: seller.email,
            telefone: seller.telefone,
            origin_zipcode: product.origin_zipcode_override || product.profile_origin_zipcode,
          },
        });
        const updated = await ProfileProductOrderStorage.markLabelPurchased(pool, id_order, result);
        log.info("label.purchased", { id_order, melhor_envio_order_id: result.melhor_envio_order_id });
        return { order: updated, ...result };
      } catch (err) {
        await ProfileProductOrderStorage.markLabelFailure(pool, id_order, err.message || "Falha desconhecida");
        log.warn("label.purchase_fail", { id_order, message: err.message });
        return { error: err.message };
      }
    });
  }

  /**
   * Job CDC: tenta etiquetas pendentes (≤5 tentativas, ≥30min entre tentativas).
   * Chamado pelo agendador no boot do servidor.
   */
  static async processPendingLabels() {
    return runWithLogs(log, "processPendingLabels", () => ({}), async () => {
      const ids = await ProfileProductOrderStorage.listPendingLabels(pool, { limit: 20 });
      if (ids.length === 0) return { processed: 0, ok: 0, fail: 0 };
      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        const r = await ProfileProductOrderService.purchaseLabelForOrder(id);
        if (r.error) fail++; else ok++;
      }
      return { processed: ids.length, ok, fail };
    });
  }

  /**
   * Endpoint do vendedor: devolve a label_pdf_url, tentando comprar se
   * ainda não foi comprada e nenhum job de retry pegou.
   */
  static async getLabelForSeller(user, id_order) {
    return runWithLogs(log, "getLabelForSeller", () => ({ id_user: user?.id_user, id_order }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const order = await ProfileProductOrderStorage.getForSeller(pool, Number(id_order), user.id_user);
      if (!order) return { error: "Pedido não encontrado" };
      if (order.label_purchased_at && order.label_pdf_url) {
        return {
          label_pdf_url: order.label_pdf_url,
          melhor_envio_order_id: order.melhor_envio_order_id,
          tracking_code: order.tracking_code,
        };
      }
      if (order.status !== "paid" && order.status !== "shipped" && order.status !== "delivered") {
        return { error: "Pedido ainda não pago" };
      }
      // Tenta comprar agora (sob demanda — se webhook falhou e retry ainda não rodou)
      const r = await ProfileProductOrderService.purchaseLabelForOrder(order.id_order);
      if (r.error) return { error: r.error };
      return {
        label_pdf_url: r.label_pdf_url || r.order?.label_pdf_url,
        melhor_envio_order_id: r.melhor_envio_order_id || r.order?.melhor_envio_order_id,
        tracking_code: r.tracking_code || r.order?.tracking_code,
      };
    });
  }

  static async listMySales(user, { limit = 50, offset = 0 } = {}) {
    return runWithLogs(log, "listMySales", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const off = Math.max(Number(offset) || 0, 0);
      const orders = await ProfileProductOrderStorage.listForSeller(pool, user.id_user, { limit: lim, offset: off });
      return { orders };
    });
  }

  /**
   * Tratamento de charge.refunded — devolve estoque, marca order como refunded,
   * reverte saldo do vendedor.
   */
  static async handleChargeRefunded(charge) {
    const payment_intent_id = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id || null;

    let order = null;
    if (payment_intent_id) {
      order = await ProfileProductOrderStorage.getByPaymentIntent(pool, payment_intent_id);
    }
    if (!order) return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (order.status === "paid" || order.status === "shipped") {
        await client.query(
          `UPDATE public.tb_profile_product
              SET stock_quantity = stock_quantity + $2, updated_at = NOW()
            WHERE id_profile_product = $1`,
          [order.id_profile_product, order.quantity]
        );
      }
      await ProfileProductOrderStorage.markRefunded(client, order.id_order);
      await SellerBalanceStorage.revertByOrder(client, order.id_order);
      await client.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async listMyOrders(user, { limit = 50, offset = 0 } = {}) {
    return runWithLogs(log, "listMyOrders", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const off = Math.max(Number(offset) || 0, 0);
      const orders = await ProfileProductOrderStorage.listForBuyer(pool, user.id_user, { limit: lim, offset: off });
      return { orders };
    });
  }
}

module.exports = ProfileProductOrderService;
module.exports.HOLDBACK_DAYS = HOLDBACK_DAYS;
