// src/services/CommunitySlotService.js
// Bundle R$100 da Comunidade: 1 pagamento sobe os DOIS tetos (+1 criar / +1
// entrar). Stripe price_data ad-hoc + webhook idempotente por session id.
// Não gera comissão de afiliado (sem coupon na metadata).

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const StripeService = require("./StripeService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunitySlotService");
const BUNDLE_PRICE_CENTS = 10000; // R$100,00

class CommunitySlotService {
  static async createCheckout(user) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user?.id_user }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const ent = await CommunityStorage.getEntitlement(pool, id_user);
        if (ent.create_cap >= 3 && ent.member_cap >= 3) {
          return {
            error: "Você já atingiu o limite máximo de 3 comunidades.",
          };
        }

        const purchase = await CommunityStorage.createSlotPurchase(pool, {
          id_user_payer: id_user,
          amount_cents: BUNDLE_PRICE_CENTS,
        });

        const emailRow = await pool.query(
          `SELECT email FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
          [id_user]
        );
        const userEmail = emailRow.rows[0]?.email || undefined;
        const baseUrl = process.env.FRONTEND_URL || "https://freelandoo.com.br";

        const session = await StripeService.createOneTimeCheckoutSession({
          amount_cents: BUNDLE_PRICE_CENTS,
          currency: "BRL",
          productName: "Ingresso de Comunidade (+1 criar / +1 entrar)",
          customerEmail: userEmail,
          clientReferenceId: String(purchase.id_purchase),
          successUrl: `${baseUrl}/comunidade?slot_purchase=success`,
          cancelUrl: `${baseUrl}/comunidade?slot_purchase=cancel`,
          metadata: {
            type: "community_slot",
            id_purchase: String(purchase.id_purchase),
            user_id: String(id_user),
          },
        });

        await CommunityStorage.setSlotPurchaseSession(
          pool,
          purchase.id_purchase,
          session.id
        );

        return { url: session.url };
      }
    );
  }

  // Confirmador do webhook. Idempotente por session id: aplicar duas vezes
  // (completed + async_succeeded, ou retry) não duplica o +1/+1.
  static async confirmStripeSession(session) {
    return runWithLogs(
      log,
      "confirmStripeSession",
      () => ({ session_id: session?.id }),
      async () => {
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const purchase = await CommunityStorage.getSlotPurchaseBySession(
            client,
            session.id
          );
          if (!purchase) {
            await client.query("ROLLBACK");
            log.warn("confirm.purchase_not_found", { session_id: session.id });
            return { error: "Compra de ingresso não encontrada." };
          }

          const id_user = await CommunityStorage.markSlotPurchaseApplied(
            client,
            session.id,
            paymentIntentId
          );
          if (!id_user) {
            // Já aplicado anteriormente — idempotente, entrega válida.
            await client.query("COMMIT");
            return { ok: true, already_applied: true };
          }

          await CommunityStorage.incrementEntitlement(client, id_user);
          await client.query("COMMIT");
          log.info("confirm.applied", { session_id: session.id, id_user });
          return { ok: true };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("confirm.fail", {
            session_id: session.id,
            error: err.message,
          });
          return { error: "Falha ao aplicar o ingresso." };
        } finally {
          client.release();
        }
      }
    );
  }

  // charge.refunded total → reverte o entitlement do bundle. Retorna true se
  // reverteu (para o webhook encerrar cedo, sem tratar como assinatura/pedido).
  static async revertRefundByPaymentIntent(conn, payment_intent_id, charge_id) {
    if (!payment_intent_id) return false;
    const purchase = await CommunityStorage.getAppliedPurchaseByPaymentIntent(
      conn,
      payment_intent_id
    );
    if (!purchase) return false;
    await CommunityStorage.markSlotPurchaseRefunded(conn, purchase.id_purchase);
    await CommunityStorage.decrementEntitlement(conn, purchase.id_user_payer);
    log.info("refund.reverted", {
      id_purchase: purchase.id_purchase,
      charge_id,
    });
    return true;
  }
}

module.exports = CommunitySlotService;
