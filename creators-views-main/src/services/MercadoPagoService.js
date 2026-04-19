const { MercadoPagoConfig, Preference } = require("mercadopago");
const { createLogger, runWithLogs } = require("../utils/logger");

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const log = createLogger("MercadoPagoService");

class MercadoPagoService {
  /**
   * Cria uma preferência no Mercado Pago para uma order já existente.
   *
   * Espera:
   * {
   *   order: { id_order, id_user, total_cents, currency },
   *   orderItem: { item_name_snapshot, quantity },
   *   payer?: { email, first_name, last_name }
   * }
   */
  static async createOrderPreference({ order, orderItem, payer = null }) {
    return runWithLogs(
      log,
      "createOrderPreference",
      () => ({
        id_order: order?.id_order,
        hasPayerEmail: !!(payer && payer.email),
      }),
      async () => {
        if (!order?.id_order) {
          throw new Error(
            "id_order é obrigatório para criar preferência no Mercado Pago"
          );
        }

        if (!orderItem) {
          throw new Error(
            "orderItem é obrigatório para criar preferência no Mercado Pago"
          );
        }

        const front = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
        const base = (process.env.BASE_URL || "").replace(/\/$/, "");

        const unitPrice = Number(order.total_cents || 0) / 100;
        const quantity = Number(orderItem.quantity || 1);
        const currency = order.currency || "BRL";

        const preference = new Preference(mpClient);

        const body = {
          items: [
            {
              title: orderItem.item_name_snapshot,
              quantity,
              unit_price: unitPrice,
              currency_id: currency,
            },
          ],

          external_reference: String(order.id_order),

          back_urls: {
            success: `${front}/payment/success`,
            failure: `${front}/payment/failure`,
            pending: `${front}/payment/pending`,
          },

          auto_return: "approved",
          notification_url: `${base}/payments/webhooks/mercadopago`,
        };

        if (payer?.email) {
          body.payer = {
            email: payer.email,
            name: payer.first_name || undefined,
            surname: payer.last_name || undefined,
          };
        }

        const result = await preference.create({ body });

        const preferenceId = result?.id || result?.body?.id || null;
        const checkoutUrl =
          result?.init_point || result?.body?.init_point || null;
        const sandboxCheckoutUrl =
          result?.sandbox_init_point || result?.body?.sandbox_init_point || null;

        if (!preferenceId || !checkoutUrl) {
          throw new Error("Preferência criada, mas não retornou id/init_point");
        }

        return {
          payment_provider: "MERCADO_PAGO",
          payment_provider_ref: String(preferenceId),
          payment_url: checkoutUrl,
          sandbox_payment_url: sandboxCheckoutUrl,
          expires_at: null,
          raw_response: result,
        };
      }
    );
  }
}

module.exports = MercadoPagoService;
