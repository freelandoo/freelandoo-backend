// src/services/CasaHologramService.js
// Hologramas colecionáveis da Casa Views (mig 274) — a aba "RA".
//
// A câmera reconhece a figura impressa e mostra o personagem em holograma rosa.
// COLECIONAR abre a cobrança (R$1,99, Mercado Pago). Quando o webhook confirma,
// a compra vira `paid` e a página de retorno — que pergunta pelo session id —
// materializa o personagem (a linha sobe e ele ganha a textura) e o guarda na
// vitrine da pessoa.
//
// ─── O CATÁLOGO MORA AQUI ───────────────────────────────────────────────────
//
// O preço é lido DAQUI, nunca do cliente. Personagem novo = uma linha aqui +
// modelo 3D e alvo de rastreamento no front (`features/acasaviews/ra/catalog.ts`),
// com a MESMA chave.
//
// ─── ADMIN COLECIONA DE GRAÇA ───────────────────────────────────────────────
//
// Pedido do Alex (2026-10-07). Administrador (papel `Administrator`) não passa
// pelo Mercado Pago: a compra nasce `paid` a R$0 com uma referência própria
// (`admin-<uuid>`) no lugar do session id — a página de retorno lê do mesmo
// jeito e materializa na hora.

const crypto = require("crypto");
const pool = require("../databases");
const PaymentGateway = require("../integrations/payments");
const CasaHologramStorage = require("../storages/CasaHologramStorage");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CasaHologramService");

const CATALOG = Object.freeze([
  { key: "muay-thai", name: "O Lutador do Coliseu", price_cents: 199 },
]);

const byKey = (key) => CATALOG.find((h) => h.key === key) || null;

class CasaHologramService {
  static get CATALOG() {
    return CATALOG;
  }

  /** O que a aba RA precisa: o catálogo com preço e o que a pessoa já tem. */
  static async listMine(user) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const [owned, isAdmin] = await Promise.all([
        CasaHologramStorage.listOwned(pool, user.id_user),
        CasaHologramStorage.isAdmin(pool, user.id_user),
      ]);
      return {
        holograms: isAdmin ? CATALOG.map((h) => ({ ...h, price_cents: 0 })) : CATALOG,
        is_admin: isAdmin,
        owned: owned.filter((o) => byKey(o.hologram_key)).map((o) => ({ key: o.hologram_key, collected_at: o.collected_at })),
      };
    });
  }

  static async createCheckout(user, body = {}) {
    return runWithLogs(log, "createCheckout", () => ({ id_user: user?.id_user, key: body?.key }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const item = byKey(String(body.key || ""));
      if (!item) return { error: "Holograma não encontrado", statusCode: 404 };
      if (await CasaHologramStorage.isOwned(pool, user.id_user, item.key)) {
        // Cobrar de novo o que já está na vitrine seria vender o que já é dela.
        return { error: "Este holograma já está na sua vitrine.", statusCode: 409, owned: true };
      }

      if (await CasaHologramStorage.isAdmin(pool, user.id_user)) {
        const purchase = await CasaHologramStorage.createFreePurchase(pool, {
          id_user: user.id_user,
          hologram_key: item.key,
          session_ref: `admin-${crypto.randomUUID()}`,
        });
        log.info("hologram.admin_free", { id_user: user.id_user, key: item.key });
        return { free: true, session_id: purchase.stripe_session_id };
      }

      const frontend = String(process.env.FRONTEND_URL || "https://www.freelandoo.com.br").replace(/\/$/, "");
      const session = await PaymentGateway.createCheckout({
        amount_cents: item.price_cents,
        currency: "BRL",
        productName: `Holograma Casa Views — ${item.name}`,
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/acasaviews/ra?holograma=${item.key}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/acasaviews/ra?holograma=cancelado`,
        metadata: { type: "casa_hologram", user_id: String(user.id_user), hologram_key: item.key },
      });

      await CasaHologramStorage.createPurchase(pool, {
        id_user: user.id_user,
        hologram_key: item.key,
        amount_cents: item.price_cents,
        stripe_session_id: session.id,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  /** A página de retorno pergunta: o pagamento já caiu? */
  static async getBySession(user, session_id) {
    return runWithLogs(log, "getBySession", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const row = await CasaHologramStorage.getBySession(pool, String(session_id || ""));
      if (!row || String(row.id_user) !== String(user.id_user)) {
        return { error: "Compra não encontrada", statusCode: 404 };
      }
      return { key: row.hologram_key, status: row.status, paid: row.status === "paid" && !row.refunded_at };
    });
  }

  /** Webhook: idempotente por session id. */
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "casa_hologram") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let purchase = await CasaHologramStorage.getBySession(client, session.id, { forUpdate: true });
      if (purchase && purchase.status === "paid") {
        await client.query("COMMIT");
        return { purchase, duplicate: true };
      }
      if (!purchase) {
        // Webhook chegou antes/no lugar da linha pendente (retry, reconciliação).
        if (!meta.user_id || !byKey(meta.hologram_key)) {
          await client.query("ROLLBACK");
          log.warn("confirm.bad_metadata", { session_id: session.id });
          return { error: "metadata_invalida" };
        }
        purchase = await CasaHologramStorage.createPurchase(client, {
          id_user: meta.user_id,
          hologram_key: meta.hologram_key,
          amount_cents: session.amount_total ?? 0,
          stripe_session_id: session.id,
        });
      }

      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;
      purchase = await CasaHologramStorage.markPaid(client, purchase.id, { stripe_payment_intent: paymentIntent });
      await client.query("COMMIT");
      log.info("hologram.paid", { id_user: purchase.id_user, key: purchase.hologram_key });
      return { purchase };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async expireBySession(stripe_session_id) {
    return CasaHologramStorage.markExpiredBySession(pool, stripe_session_id);
  }

  /** Estorno total tira o holograma da vitrine. */
  static async handleChargeRefunded(charge) {
    const ref =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
    if (!ref) return { ignored: true };
    const purchase = await CasaHologramStorage.getByPaymentIntent(pool, ref);
    if (!purchase) return { ignored: true };
    if (!isFullRefund(charge)) return { handled: false, partial: true };
    if (purchase.refunded_at) return { handled: true, duplicate: true };
    await CasaHologramStorage.markRefunded(pool, purchase.id);
    log.info("hologram.refunded", { id: purchase.id, id_user: purchase.id_user });
    return { handled: true };
  }
}

module.exports = CasaHologramService;
