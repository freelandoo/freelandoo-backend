// src/services/XpBoostService.js
// Booster de XP: R$10 que leva um subperfil escolhido direto ao nível 5.
// Stripe price_data ad-hoc + webhook idempotente por session id. Sem comissão
// de afiliado. Entrega = evento de XP idempotente (top-up até o nível-alvo) +
// recálculo do nível. Espelha PolenProductService.
const pool = require("../databases");
const StripeService = require("./StripeService");
const XpBoostStorage = require("../storages/XpBoostStorage");
const XpStorage = require("../storages/XpStorage");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("XpBoostService");

const PRICE_CENTS = 1000; // R$10,00
const TARGET_LEVEL = 5;

class XpBoostService {
  static async createCheckout(user, body = {}) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user?.id_user, id_profile: body?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const id_profile = body?.id_profile;
        if (!id_profile) return { error: "Selecione um subperfil." };

        const r = await pool.query(
          `SELECT id_user, is_clan, xp_level, display_name
             FROM public.tb_profile
            WHERE id_profile = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [id_profile]
        );
        const profile = r.rowCount ? r.rows[0] : null;
        if (!profile) return { error: "Perfil não encontrado." };
        if (String(profile.id_user) !== String(user.id_user)) {
          return { error: "Este perfil não é seu." };
        }
        if (profile.is_clan) return { error: "Clãs não recebem booster de XP." };
        if (Number(profile.xp_level) >= TARGET_LEVEL) {
          return { error: `Este perfil já está no nível ${TARGET_LEVEL} ou acima.` };
        }

        const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
        const session = await StripeService.createOneTimeCheckoutSession({
          amount_cents: PRICE_CENTS,
          currency: "BRL",
          productName: `Booster de XP — Nível ${TARGET_LEVEL}`,
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${frontend}/loja-polens?xp_boost=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontend}/loja-polens?xp_boost=cancel`,
          metadata: {
            type: "xp_boost",
            user_id: user.id_user,
            id_profile,
            target_level: String(TARGET_LEVEL),
          },
        });

        await XpBoostStorage.createPurchase(pool, {
          user_id: user.id_user,
          id_profile,
          target_level: TARGET_LEVEL,
          amount_cents: PRICE_CENTS,
          stripe_session_id: session.id,
        });

        return { checkout_url: session.url, session_id: session.id };
      }
    );
  }

  // Webhook: idempotente por session id. Credita XP até o nível-alvo e recalcula.
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "xp_boost") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await XpBoostStorage.getByStripeSession(client, session.id);
      if (existing && existing.status === "paid") {
        await client.query("COMMIT");
        return { purchase: existing, duplicate: true };
      }

      const id_profile = meta.id_profile;
      const target = Number(meta.target_level) || TARGET_LEVEL;

      const settings = await XpStorage.getSettings(client);
      const base = Number(settings?.base_xp_level_1 ?? 5000);
      const mult = Number(settings?.level_multiplier ?? 1.4);

      const pr = await client.query(
        `SELECT COALESCE(xp_total, 0) AS xp_total FROM public.tb_profile WHERE id_profile = $1 LIMIT 1`,
        [id_profile]
      );
      if (!pr.rowCount) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      const xpTotal = Number(pr.rows[0].xp_total) || 0;
      const targetXp = XpStorage.xpForLevel(target, base, mult);
      const needed = Math.max(0, targetXp - xpTotal);

      // Evento idempotente (source_id = session.id). Se needed=0 (já passou do
      // alvo), não credita — mas ainda marca a compra como paga (sem reembolso auto).
      if (needed > 0) {
        await XpStorage.addEvent(client, {
          id_profile,
          event_type: "xp_boost_level",
          source_type: "xp_boost",
          source_id: session.id,
          xp_amount: needed,
          metadata: { target_level: target, price_cents: PRICE_CENTS },
        });
        await XpStorage.recalcProfileXp(client, id_profile);
      }

      const paymentIntent = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

      let purchase = existing;
      if (!purchase) {
        purchase = await XpBoostStorage.createPurchase(client, {
          user_id: meta.user_id,
          id_profile,
          target_level: target,
          amount_cents: session.amount_total ?? PRICE_CENTS,
          stripe_session_id: session.id,
        });
      }
      purchase = await XpBoostStorage.markPaid(client, purchase.id, {
        xp_granted: needed,
        stripe_payment_intent: paymentIntent,
      });

      await client.query("COMMIT");
      return { purchase, xp_granted: needed };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Reembolso total: reverte o XP creditado e recalcula o nível.
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const purchase = await XpBoostStorage.getByPaymentIntent(pool, paymentIntentId);
    if (!purchase) return { ignored: true };

    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", {
        purchase_id: purchase.id,
        amount_refunded: charge.amount_refunded,
      });
      return { handled: false, partial: true };
    }
    if (purchase.refunded_at) return { handled: true, duplicate: true };

    const granted = Number(purchase.xp_granted) || 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (granted > 0) {
        await XpStorage.addEvent(client, {
          id_profile: purchase.id_profile,
          event_type: "xp_boost_refund",
          source_type: "xp_boost_refund",
          source_id: charge.id,
          xp_amount: -granted,
          metadata: { reason: "charge.refunded" },
        });
        await XpStorage.recalcProfileXp(client, purchase.id_profile);
      }
      await XpBoostStorage.markRefunded(client, purchase.id);
      await client.query("COMMIT");
      return { handled: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = XpBoostService;
