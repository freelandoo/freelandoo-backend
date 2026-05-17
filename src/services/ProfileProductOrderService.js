const pool = require("../databases");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const SellerBalanceStorage = require("../storages/SellerBalanceStorage");
const ShippingService = require("./ShippingService");
const StripeService = require("./StripeService");
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

      const unit = Number(product.price_amount) || 0;
      const shipping_cents = option.price_cents;
      const total_cents = unit * quantity + shipping_cents;

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const successUrl = `${frontend}/account/compras?status=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${frontend}/p/${product.id_profile}/produto/${id_profile_product}?status=cancel`;

      const session = await StripeService.createMultiItemCheckoutSession({
        line_items: [
          { name: product.name, amount_cents: unit, quantity },
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
        },
      });

      const order = await ProfileProductOrderStorage.create(pool, {
        id_buyer_user: user.id_user,
        id_profile_product,
        id_seller_profile: product.id_profile,
        id_seller_user: product.owner_id_user,
        quantity,
        unit_price_cents: unit,
        shipping_cents,
        total_cents,
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
      if (payment_intent_id) {
        try {
          const stripe = StripeService.client();
          const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
          charge_id = typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : pi.latest_charge?.id || null;
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

      const paid = await ProfileProductOrderStorage.markPaid(client, existing.id_order, {
        payment_intent_id,
        charge_id,
      });

      // Cria saldo do vendedor — gross/net = total - frete (frete vai pro
      // vendedor também já que ele paga a etiqueta). Platform fee = 0 por enquanto.
      const gross = Number(paid.total_cents) || 0;
      const shipping = Number(paid.shipping_cents) || 0;
      const platform_fee = 0;
      const net = gross - platform_fee;
      const available_at = new Date(Date.now() + HOLDBACK_DAYS * 24 * 60 * 60 * 1000);

      await SellerBalanceStorage.create(client, {
        id_seller_user: paid.id_seller_user,
        id_seller_profile: paid.id_seller_profile,
        id_order: paid.id_order,
        gross_cents: gross,
        platform_fee_cents: platform_fee,
        shipping_cents: shipping,
        net_cents: net,
        status: "aguardando",
        available_at,
      });

      await client.query("COMMIT");
      return { order: paid };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
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
