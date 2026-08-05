// src/services/FunctionStoreService.js
// Loja de Funções: as funções da conta (mig 186) viram produtos compráveis
// (mig 191). Compra VITALÍCIA via Stripe price_data ad-hoc, sem comissão de
// afiliado. Dono = compra paga sem reembolso; reembolso total revoga.
// Produto com is_for_sale = FALSE é função GRÁTIS (comporta-se como antes).
// Espelha XpBoostService (idempotência por session id, expire, refund).
const pool = require("../databases");
const StripeService = require("./StripeService");
const FunctionStoreStorage = require("../storages/FunctionStoreStorage");
const PolenStorage = require("../storages/PolenStorage");
const { USER_FEATURE_KEYS } = require("../utils/userFeatureKeys");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FunctionStoreService");

class FunctionStoreService {
  /* ------------------------------ vitrine ------------------------------- */

  static async listProducts() {
    return runWithLogs(log, "listProducts", () => ({}), async () => {
      const products = await FunctionStoreStorage.listProducts(pool, { onlyForSale: true });
      return { products };
    });
  }

  static async getProduct(feature_key) {
    return runWithLogs(log, "getProduct", () => ({ feature_key }), async () => {
      if (!USER_FEATURE_KEYS.includes(feature_key)) {
        return { error: "Função desconhecida", statusCode: 404 };
      }
      const product = await FunctionStoreStorage.getProductByKey(pool, feature_key);
      if (!product || !product.is_for_sale) {
        return { error: "Função não está à venda", statusCode: 404 };
      }
      return { product };
    });
  }

  // Mapa de posse do usuário: chave → owned. Função fora do catálogo ou com
  // is_for_sale = FALSE conta como possuída (grátis).
  static async ownershipMap(id_user) {
    const products = await FunctionStoreStorage.listProducts(pool);
    const ownedKeys = id_user
      ? await FunctionStoreStorage.listOwnedKeys(pool, id_user)
      : [];
    const ownedSet = new Set(ownedKeys);
    const owned = {};
    for (const key of USER_FEATURE_KEYS) {
      const product = products.find((p) => p.feature_key === key);
      owned[key] = !product || !product.is_for_sale || ownedSet.has(key);
    }
    return owned;
  }

  /* ------------------------------ checkout ------------------------------ */

  static async createCheckout(user, feature_key) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user?.id_user, feature_key }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!USER_FEATURE_KEYS.includes(feature_key)) {
          return { error: "Função desconhecida" };
        }
        const product = await FunctionStoreStorage.getProductByKey(pool, feature_key);
        if (!product || !product.is_for_sale) {
          return { error: "Esta função não está à venda." };
        }
        if (!Number(product.price_cents)) {
          return { error: "Esta função está sem preço configurado." };
        }
        const alreadyOwns = await FunctionStoreStorage.userOwnsFunction(
          pool,
          user.id_user,
          feature_key
        );
        if (alreadyOwns) return { error: "Você já possui esta função." };

        const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
        const session = await StripeService.createOneTimeCheckoutSession({
          amount_cents: Number(product.price_cents),
          currency: "BRL",
          productName: `Função ${product.nav_label} — Freelandoo`,
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${frontend}/funcoes/${feature_key}?compra=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontend}/funcoes/${feature_key}?compra=cancel`,
          metadata: {
            type: "function_purchase",
            user_id: user.id_user,
            feature_key,
            id_product: product.id,
          },
        });

        await FunctionStoreStorage.createPurchase(pool, {
          id_user: user.id_user,
          feature_key,
          id_product: product.id,
          amount_cents: Number(product.price_cents),
          stripe_session_id: session.id,
        });

        return { checkout_url: session.url, session_id: session.id };
      }
    );
  }

  /* --------------------------- compra por Poléns ------------------------- */

  // Caminho alternativo ao Stripe (mig 195): a função sai da carteira de
  // Poléns. Vale para produto com price_polens > 0; o resultado é a MESMA
  // compra vitalícia (status 'paid', provider 'polens'), então a posse e o
  // gate do front não mudam. Sem reembolso automático — revogação é manual
  // pelo admin, como no admin_grant.
  static async purchaseWithPolens(user, feature_key) {
    return runWithLogs(
      log,
      "purchaseWithPolens",
      () => ({ id_user: user?.id_user, feature_key }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!USER_FEATURE_KEYS.includes(feature_key)) {
          return { error: "Função desconhecida" };
        }
        const product = await FunctionStoreStorage.getProductByKey(pool, feature_key);
        if (!product || !product.is_for_sale) {
          return { error: "Esta função não está à venda." };
        }
        const amount = Number(product.price_polens) || 0;
        if (amount <= 0) {
          return { error: "Esta função não pode ser comprada com Poléns." };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const settings = await PolenStorage.getSettings(client);
          if (!settings?.is_active) {
            await client.query("ROLLBACK");
            return { error: "Sistema de Poléns inativo" };
          }

          // getOrCreateWallet trava a linha da carteira até o COMMIT: duas
          // compras simultâneas do mesmo usuário serializam aqui, então a
          // checagem de posse abaixo já enxerga a primeira (não existe UNIQUE
          // parcial de posse — decisão do desenho da mig 191).
          const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);

          const alreadyOwns = await FunctionStoreStorage.userOwnsFunction(
            client,
            user.id_user,
            feature_key
          );
          if (alreadyOwns) {
            await client.query("ROLLBACK");
            return { error: "Você já possui esta função." };
          }

          const purchase = await FunctionStoreStorage.createPurchase(client, {
            id_user: user.id_user,
            feature_key,
            id_product: product.id,
            amount_cents: 0,
            amount_polens: amount,
            stripe_session_id: null,
            payment_provider: "polens",
            status: "paid",
          });

          const debit = await PolenStorage.debit(client, {
            user_id: user.id_user,
            wallet_id: wallet.id,
            amount,
            type: "spend_function_purchase",
            source: "function_store",
            source_id: `function:${feature_key}:${purchase.id}`,
            metadata: { feature_key, id_product: product.id, purchase_id: purchase.id },
          });
          if (!debit) {
            await client.query("ROLLBACK");
            return {
              error: `Você precisa de ${amount} Poléns para comprar esta função.`,
              code: "insufficient_balance",
            };
          }

          await client.query("COMMIT");
          log.info("purchase.polens", {
            id_user: user.id_user,
            feature_key,
            amount_polens: amount,
          });
          return {
            message: "Função liberada na sua conta.",
            purchase,
            wallet: debit.wallet,
            transaction: debit.transaction,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  // Webhook (completed/async_payment_succeeded): idempotente por session id.
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "function_purchase") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await FunctionStoreStorage.getByStripeSession(client, session.id);
      if (existing && existing.status === "paid") {
        await client.query("COMMIT");
        return { purchase: existing, duplicate: true };
      }

      const paymentIntent = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

      let purchase = existing;
      if (!purchase) {
        // Webhook chegou antes/no lugar da linha pendente (retry, reconciliação).
        purchase = await FunctionStoreStorage.createPurchase(client, {
          id_user: meta.user_id,
          feature_key: meta.feature_key,
          id_product: meta.id_product || null,
          amount_cents: session.amount_total ?? 0,
          stripe_session_id: session.id,
        });
      }
      purchase = await FunctionStoreStorage.markPaid(client, purchase.id, {
        stripe_payment_intent: paymentIntent,
      });

      await client.query("COMMIT");
      log.info("purchase.paid", {
        id_user: purchase.id_user,
        feature_key: purchase.feature_key,
        session_id: session.id,
      });
      return { purchase };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // checkout.session.expired / async_payment_failed → linha pendente expira.
  static async expireBySession(stripe_session_id) {
    return FunctionStoreStorage.markExpiredBySession(pool, stripe_session_id);
  }

  // Reembolso TOTAL revoga a função (owned exige refunded_at IS NULL).
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const purchase = await FunctionStoreStorage.getByPaymentIntent(pool, paymentIntentId);
    if (!purchase) return { ignored: true };

    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", {
        purchase_id: purchase.id,
        amount_refunded: charge.amount_refunded,
      });
      return { handled: false, partial: true };
    }
    if (purchase.refunded_at) return { handled: true, duplicate: true };

    await FunctionStoreStorage.markRefunded(pool, purchase.id);
    log.info("purchase.refunded", {
      purchase_id: purchase.id,
      id_user: purchase.id_user,
      feature_key: purchase.feature_key,
    });
    return { handled: true };
  }

  /* -------------------------------- admin ------------------------------- */

  static async adminListProducts() {
    return runWithLogs(log, "adminListProducts", () => ({}), async () => {
      const products = await FunctionStoreStorage.listProducts(pool);
      const stats = await FunctionStoreStorage.purchaseStats(pool);
      const byKey = Object.fromEntries(stats.map((s) => [s.feature_key, s]));
      return {
        products: products.map((p) => ({
          ...p,
          owners: byKey[p.feature_key]?.owners || 0,
          revenue_cents: Number(byKey[p.feature_key]?.revenue_cents || 0),
          revenue_polens: Number(byKey[p.feature_key]?.revenue_polens || 0),
        })),
      };
    });
  }

  static async adminUpdateProduct(id, body = {}, file = null) {
    return runWithLogs(log, "adminUpdateProduct", () => ({ id }), async () => {
      const product = await FunctionStoreStorage.getProductById(pool, id);
      if (!product) return { error: "Produto não encontrado", statusCode: 404 };

      const fields = {};
      const textFields = [
        "nav_label", "eyebrow", "headline", "short_description", "full_description",
        "background_color", "accent_color", "text_color", "placeholder_color",
      ];
      for (const key of textFields) {
        if (body[key] !== undefined) fields[key] = String(body[key]);
      }
      if (body.price_cents !== undefined) {
        const cents = Math.round(Number(body.price_cents));
        if (!Number.isFinite(cents) || cents < 0) {
          return { error: "Preço inválido" };
        }
        fields.price_cents = cents;
      }
      // Preço em Poléns: 0 (ou campo vazio) = função não vendida por Poléns.
      // Grava 0, nunca NULL: o seed da mig 195 semeia só onde está NULL, então
      // desligar pelo admin tem que deixar um valor concreto — senão o próximo
      // boot do backend ressuscitaria os 1000 Poléns por cima da decisão dele.
      if (body.price_polens !== undefined) {
        const raw = String(body.price_polens).trim();
        const polens = raw === "" ? 0 : Math.round(Number(raw));
        if (!Number.isFinite(polens) || polens < 0) {
          return { error: "Preço em Poléns inválido" };
        }
        fields.price_polens = polens;
      }
      if (body.is_for_sale !== undefined) {
        fields.is_for_sale = body.is_for_sale === true || body.is_for_sale === "true";
      }
      if (body.sort_order !== undefined) {
        const order = Math.round(Number(body.sort_order));
        if (Number.isFinite(order)) fields.sort_order = order;
      }
      if (file) {
        const uploadFunctionProductImage = require("../integrations/r2/uploadFunctionProductImage");
        fields.image_url = await uploadFunctionProductImage({ file });
      } else if (body.image_url !== undefined) {
        fields.image_url = body.image_url ? String(body.image_url) : null;
      }

      const updated = await FunctionStoreStorage.updateProduct(pool, id, fields);
      return { product: updated };
    });
  }

  static async adminListPurchases(query = {}) {
    return runWithLogs(log, "adminListPurchases", () => ({}), async () => {
      const page = Math.max(1, Number(query.page) || 1);
      const purchases = await FunctionStoreStorage.listPurchases(pool, {
        page,
        per_page: 50,
        feature_key: query.feature_key || null,
      });
      return { purchases, page };
    });
  }

  // Concessão manual (suporte): cria compra paga com amount 0 via admin_grant.
  static async adminGrant(body = {}) {
    return runWithLogs(
      log,
      "adminGrant",
      () => ({ username: body.username, feature_key: body.feature_key }),
      async () => {
        const feature_key = String(body.feature_key || "").trim();
        const username = String(body.username || "").trim().replace(/^@/, "");
        if (!USER_FEATURE_KEYS.includes(feature_key)) {
          return { error: "Função desconhecida" };
        }
        if (!username) return { error: "Informe o @username" };

        const u = await pool.query(
          `SELECT id_user, username FROM public.tb_user WHERE LOWER(username) = LOWER($1) LIMIT 1`,
          [username]
        );
        if (!u.rowCount) return { error: "Usuário não encontrado" };
        const id_user = u.rows[0].id_user;

        const alreadyOwns = await FunctionStoreStorage.userOwnsFunction(pool, id_user, feature_key);
        if (alreadyOwns) return { error: "Usuário já possui esta função." };

        const product = await FunctionStoreStorage.getProductByKey(pool, feature_key);
        const purchase = await FunctionStoreStorage.createPurchase(pool, {
          id_user,
          feature_key,
          id_product: product?.id || null,
          amount_cents: 0,
          stripe_session_id: null,
          payment_provider: "admin_grant",
          status: "paid",
        });
        return { purchase };
      }
    );
  }

  static async adminRevoke(body = {}) {
    return runWithLogs(
      log,
      "adminRevoke",
      () => ({ username: body.username, feature_key: body.feature_key }),
      async () => {
        const feature_key = String(body.feature_key || "").trim();
        const username = String(body.username || "").trim().replace(/^@/, "");
        if (!USER_FEATURE_KEYS.includes(feature_key)) {
          return { error: "Função desconhecida" };
        }
        const u = await pool.query(
          `SELECT id_user FROM public.tb_user WHERE LOWER(username) = LOWER($1) LIMIT 1`,
          [username]
        );
        if (!u.rowCount) return { error: "Usuário não encontrado" };

        const revoked = await FunctionStoreStorage.revokeOwnership(pool, u.rows[0].id_user, feature_key);
        if (!revoked) return { error: "Usuário não possui esta função." };
        return { revoked: true };
      }
    );
  }
}

module.exports = FunctionStoreService;
