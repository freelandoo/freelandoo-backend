const { MercadoPagoConfig, Preference } = require("mercadopago");
const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");
const AffiliateConversionService = require("../services/AffiliateConversionService");
const { createLogger } = require("../utils/logger");

const log = createLogger("PaymentController");

/** tb_status: taxa pendente → removido no pagamento aprovado da order */
const STATUS_TAXA_PENDENTE = "7514f5bb-8f05-4dee-b70b-cae6cf38f8bc";
/** tb_status: perfil ativo → aplicado após pagamento aprovado */
const STATUS_PERFIL_ATIVO = "d2a5a959-b83b-4d02-b930-c408a7c971ac";

// Cliente do Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

class PaymentController {
  static async createActivationPayment(req, res) {
    const db = await pool.connect();

    try {
      const { id_user } = req.user;

      log.info("createActivationPayment.called", {
        id_user,
        mp_token_prefix: process.env.MP_ACCESS_TOKEN
          ? process.env.MP_ACCESS_TOKEN.slice(0, 7)
          : null,
      });

      // 1) pega o item da tabela de preços
      const priceResult = await db.query(
        `
        SELECT code, name, amount_cents, currency
        FROM tb_billing_item
        WHERE code = 'activation_fee' AND active = true
        LIMIT 1
        `
      );

      const item = priceResult.rows[0];
      if (!item) {
        log.warn("createActivationPayment.billing_item_missing", {
          code: "activation_fee",
        });
        return res.status(500).json({
          error: "Item de cobrança 'activation_fee' não configurado",
        });
      }

      const amountCents = Number(item.amount_cents);
      const unit_price = amountCents / 100;
      const currency = item.currency || "BRL";

      const front = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const base = (process.env.BASE_URL || "").replace(/\/$/, "");

      log.info("createActivationPayment.billing_item_loaded", {
        code: item.code,
        name: item.name,
        amountCents,
        currency,
        front,
        notification_url: `${base}/payments/webhooks/mercadopago`,
      });

      // 2) cria preferência no Mercado Pago
      const preference = new Preference(mpClient);

      const result = await preference.create({
        body: {
          items: [
            {
              title: item.name,
              quantity: 1,
              unit_price: unit_price,
            },
          ],

          external_reference: String(id_user),

          back_urls: {
            success: `${front}/payment/success`,
            failure: `${front}/payment/failure`,
            pending: `${front}/payment/pending`,
          },

          auto_return: "approved",

          notification_url: `${base}/payments/webhooks/mercadopago`,
        },
      });

      const providerPreferenceId = result?.id || result?.body?.id || null;
      const checkoutUrl =
        result?.init_point || result?.body?.init_point || null;

      log.info("createActivationPayment.preference_created", {
        providerPreferenceId,
        hasCheckoutUrl: Boolean(checkoutUrl),
      });

      if (!providerPreferenceId || !checkoutUrl) {
        log.warn("createActivationPayment.preference_incomplete", { result });
        return res.status(500).json({
          error: "Preferência criada, mas não retornou dados esperados",
        });
      }

      // 3) registra tentativa (pending)
      const insertRes = await db.query(
        `
        INSERT INTO payments (
          user_id,
          provider,
          provider_preference_id,
          type,
          status,
          amount_cents,
          currency
        )
        VALUES ($1, 'mercadopago', $2, 'activation_fee', 'pending', $3, $4)
        RETURNING id, created_at
        `,
        [id_user, String(providerPreferenceId), amountCents, currency]
      );

      log.info("createActivationPayment.payment_row_pending", {
        payment_row_id: insertRes.rows[0]?.id,
        created_at: insertRes.rows[0]?.created_at,
        providerPreferenceId,
      });

      return res.status(200).json({
        preferenceId: providerPreferenceId,
        checkoutUrl,
      });
    } catch (error) {
      log.error("createActivationPayment.fail", error);
      return res.status(500).json({
        error: "Erro ao criar preferência no Mercado Pago",
        details: error?.message || null,
      });
    } finally {
      db.release();
    }
  }

  static async handleMercadoPagoWebhook(req, res) {
    const db = await pool.connect();

    try {
      const topic = String(
        req.query?.topic || req.query?.type || req.body?.type || ""
      ).toLowerCase();

      const action = String(req.body?.action || "").toLowerCase();

      const dataId =
        req.body?.data?.id || req.query?.data_id || req.query?.id || null;

      if (!dataId) {
        return res.sendStatus(200);
      }

      let paymentId = null;

      if (
        topic === "payment" ||
        topic === "payments" ||
        action.includes("payment")
      ) {
        paymentId = String(dataId);
      }

      if (
        !paymentId &&
        (topic === "merchant_order" || topic === "merchant_orders")
      ) {
        const moRes = await fetch(
          `https://api.mercadopago.com/merchant_orders/${dataId}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
            },
          }
        );

        const merchantOrder = await moRes.json();

        if (!moRes.ok) {
          log.error("webhook.merchant_order_error", merchantOrder);
          return res.sendStatus(200);
        }

        const moPayments = Array.isArray(merchantOrder?.payments)
          ? merchantOrder.payments
          : [];

        const firstPayment = moPayments.find((p) => p?.id) || null;

        if (!firstPayment) {
          return res.sendStatus(200);
        }

        paymentId = String(firstPayment.id);
      }

      if (!paymentId) {
        return res.sendStatus(200);
      }

      const mpRes = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          },
        }
      );

      const payment = await mpRes.json();

      if (!mpRes.ok) {
        log.error("webhook.payment_fetch_error", payment);
        return res.sendStatus(200);
      }

      const externalReference = String(payment?.external_reference || "");
      if (!externalReference) {
        return res.sendStatus(200);
      }

      const mpStatus = String(payment?.status || "").toLowerCase();

      let mappedStatus = "PENDING_PAYMENT";

      if (mpStatus === "approved") {
        mappedStatus = "PAID";
      } else if (
        [
          "rejected",
          "cancelled",
          "cancelled_by_user",
          "charged_back",
          "refunded",
        ].includes(mpStatus)
      ) {
        mappedStatus = "CANCELED";
      } else if (["in_process", "pending", "authorized"].includes(mpStatus)) {
        mappedStatus = "PENDING_PAYMENT";
      }

      // Idempotência forte: (provider_payment_id, mapped_status) único.
      // Se esse par já foi processado, o INSERT retorna 0 linhas e saímos cedo.
      const eventInsert = await db.query(
        `
                INSERT INTO tb_mp_webhook_event (
                    provider_payment_id,
                    mapped_status,
                    external_reference,
                    raw
                )
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (provider, provider_payment_id, mapped_status) DO NOTHING
                RETURNING id_event
                `,
        [String(paymentId), mappedStatus, externalReference, payment]
      );

      if (eventInsert.rowCount === 0) {
        log.info("webhook.duplicate_event.skip", {
          paymentId,
          mappedStatus,
          externalReference,
        });
        return res.sendStatus(200);
      }

      const existing = await db.query(
        `
                SELECT id_order, status, payment_provider_ref, id_profile, id_user, total_cents, created_at
                FROM tb_order
                WHERE id_order = $1
                LIMIT 1
                `,
        [externalReference]
      );

      if (existing.rowCount === 0) {
        return res.sendStatus(200);
      }

      const orderRow = existing.rows[0];

      await db.query(
        `
                UPDATE tb_order
                SET
                    status = $2,
                    approved_at = CASE WHEN $2 = 'PAID' THEN NOW() ELSE approved_at END,
                    paid_at = CASE WHEN $2 = 'PAID' THEN NOW() ELSE paid_at END,
                    raw_webhook = $3,
                    updated_at = NOW()
                WHERE id_order = $1
                `,
        [externalReference, mappedStatus, payment]
      );

      if (mappedStatus === "PAID" && orderRow.id_profile) {
        await ProfileStorage.deleteProfileStatus(db, {
          id_profile: orderRow.id_profile,
          id_status: STATUS_TAXA_PENDENTE,
        });
        await ProfileStorage.insertProfileStatus(db, {
          id_profile: orderRow.id_profile,
          id_status: STATUS_PERFIL_ATIVO,
          created_by: orderRow.id_user,
        });
      }

      // Propaga pra camada de afiliado (PAID→APPROVED, CANCELED→REVERSED).
      if (mappedStatus === "PAID" || mappedStatus === "CANCELED") {
        await AffiliateConversionService.onOrderStatusChange(db, {
          order: { ...orderRow, id_order: externalReference },
          newStatus: mappedStatus,
          source: "mp_webhook",
          source_event_id: `${paymentId}:${mappedStatus}`,
          payload: payment,
        });
      }

      return res.sendStatus(200);
    } catch (error) {
      log.error("webhook.fail", error);
      return res.sendStatus(200);
    } finally {
      db.release();
    }
  }

  /**
   * GET /payments/history
   * Histórico do usuário logado (com paginação e filtros)
   * Query: page, limit, status, type, provider
   */
  static async listMyHistory(req, res) {
    const db = await pool.connect();
    try {
      const { id_user } = req.user;

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "20", 10), 1),
        100
      );
      const offset = (page - 1) * limit;

      const { status, type, provider } = req.query;

      const where = [`user_id = $1`];
      const params = [id_user];
      let idx = params.length;

      if (status) {
        idx++;
        where.push(`status = $${idx}`);
        params.push(status);
      }

      if (type) {
        idx++;
        // Se sua coluna for type sem aspas, troque "type" por type aqui
        where.push(`"type" = $${idx}`);
        params.push(type);
      }

      if (provider) {
        idx++;
        where.push(`provider = $${idx}`);
        params.push(provider);
      }

      const totalSql = `
        SELECT COUNT(*)::int AS total
        FROM payments
        WHERE ${where.join(" AND ")}
      `;
      const totalRes = await db.query(totalSql, params);
      const total = totalRes.rows[0]?.total ?? 0;

      const dataSql = `
        SELECT
          id,
          provider,
          provider_preference_id,
          provider_payment_id,
          "type",
          status,
          amount_cents,
          currency,
          created_at,
          updated_at,
          approved_at
        FROM payments
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${idx + 1} OFFSET $${idx + 2}
      `;

      const dataParams = [...params, limit, offset];
      const dataRes = await db.query(dataSql, dataParams);

      return res.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        items: dataRes.rows,
      });
    } catch (error) {
      log.error("listMyHistory.fail", error);
      return res.status(500).json({ error: "Erro interno no servidor" });
    } finally {
      db.release();
    }
  }

  /**
   * GET /payments/:id
   * Detalhe do pagamento do usuário logado
   */
  static async getMyPaymentById(req, res) {
    const db = await pool.connect();
    try {
      const { id_user } = req.user;
      const { id } = req.params;

      const result = await db.query(
        `
        SELECT
          id,
          user_id,
          provider,
          provider_preference_id,
          provider_payment_id,
          "type",
          status,
          amount_cents,
          currency,
          created_at,
          updated_at,
          approved_at,
          raw_webhook
        FROM payments
        WHERE id = $1 AND user_id = $2
        `,
        [id, id_user]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Pagamento não encontrado" });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      log.error("getMyPaymentById.fail", error);
      return res.status(500).json({ error: "Erro interno no servidor" });
    } finally {
      db.release();
    }
  }
}

module.exports = PaymentController;
