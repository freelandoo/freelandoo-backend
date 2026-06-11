const crypto = require("crypto");
const pool = require("../databases");
const PremiumStorage = require("../storages/PremiumStorage");
const PolenStorage = require("../storages/PolenStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const StripeService = require("./StripeService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PremiumService");

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

async function loadProfileForPremium(conn, profileId) {
  const profile = await ProfileStorage.getProfileById(conn, profileId);
  if (!profile) return { error: "Perfil não encontrado" };
  if (profile.deleted_at) return { error: "Perfil removido" };
  if (profile.is_clan) return { error: "Clans não podem ter premium" };
  if (!profile.estado || !profile.municipio) {
    return { error: "Preencha estado e cidade do perfil antes de comprar premium" };
  }
  return { profile };
}

class PremiumService {
  /**
   * Quote pública: preço, vagas disponíveis, e disponibilidade pra um perfil.
   * Não exige login (UI pode mostrar antes do login).
   */
  static async getQuoteForProfile(profileId) {
    return runWithLogs(log, "getQuoteForProfile", () => ({ profileId }), async () => {
      const loaded = await loadProfileForPremium(pool, profileId);
      if (loaded.error) return { error: loaded.error };
      const { profile } = loaded;

      const pricing = await PremiumStorage.resolvePricing(pool, {
        uf: profile.estado,
        city_name: profile.municipio,
      });
      if (!pricing) return { error: "Configuração de premium não encontrada" };
      if (!pricing.is_active) return { error: "Premium temporariamente desabilitado" };

      const taken = await PremiumStorage.countActiveByCity(pool, {
        uf: profile.estado,
        city_name: profile.municipio,
      });
      const slotsAvailable = Math.max(0, pricing.slots - taken);
      const active = await PremiumStorage.getActiveForProfile(pool, profile.id_profile);

      return {
        profile: {
          id_profile: profile.id_profile,
          display_name: profile.display_name,
          uf: profile.estado,
          city_name: profile.municipio,
        },
        pricing: {
          duration_days: pricing.duration_days,
          price_cents: pricing.price_cents,
          price_polens: pricing.price_polens,
        },
        slots: {
          total: pricing.slots,
          taken,
          available: slotsAvailable,
        },
        active: active
          ? {
              id: active.id,
              activated_at: active.activated_at,
              expires_at: active.expires_at,
            }
          : null,
      };
    });
  }

  /**
   * Compra com Poléns (transação atômica: debita + cria registro ativo).
   */
  static async checkoutWithPolens(user, profileId) {
    return runWithLogs(log, "checkoutWithPolens", () => ({
      id_user: user?.id_user,
      profileId,
    }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const loaded = await loadProfileForPremium(pool, profileId);
      if (loaded.error) return { error: loaded.error };
      const { profile } = loaded;
      if (profile.id_user !== user.id_user) return { error: "Perfil não pertence ao usuário" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (await PremiumStorage.hasActiveForProfile(client, profile.id_profile)) {
          await client.query("ROLLBACK");
          return { error: "Este perfil já tem premium ativo" };
        }

        const pricing = await PremiumStorage.resolvePricing(client, {
          uf: profile.estado,
          city_name: profile.municipio,
        });
        if (!pricing || !pricing.is_active) {
          await client.query("ROLLBACK");
          return { error: "Premium indisponível no momento" };
        }
        const taken = await PremiumStorage.countActiveByCity(client, {
          uf: profile.estado,
          city_name: profile.municipio,
        });
        if (taken >= pricing.slots) {
          await client.query("ROLLBACK");
          return { error: "Cidade lotada — sem vagas premium disponíveis" };
        }

        const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);
        const sourceId = `premium:${profile.id_profile}:${crypto.randomUUID()}`;
        const debit = await PolenStorage.debit(client, {
          user_id: user.id_user,
          wallet_id: wallet.id,
          amount: pricing.price_polens,
          type: "spend_premium",
          source: "premium",
          source_id: sourceId,
          metadata: { profile_id: profile.id_profile, uf: profile.estado, city: profile.municipio },
        });
        if (!debit) {
          await client.query("ROLLBACK");
          return { error: "Saldo de Poléns insuficiente" };
        }

        const pending = await PremiumStorage.createPending(client, {
          profile_id: profile.id_profile,
          payment_method: "polens",
          amount_polens: pricing.price_polens,
          uf: profile.estado,
          city_name: profile.municipio,
        });
        const activated = await PremiumStorage.activate(client, pending.id, {
          duration_days: pricing.duration_days,
        });

        await client.query("COMMIT");
        return { premium: activated, wallet: debit.wallet, transaction: debit.transaction };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Cria Stripe Checkout Session pro premium. Cria também um registro pending
   * (UNIQUE em stripe_session_id garante idempotência se o webhook chegar antes).
   */
  static async createStripeCheckout(user, profileId, body = {}) {
    return runWithLogs(log, "createStripeCheckout", () => ({
      id_user: user?.id_user,
      profileId,
    }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const loaded = await loadProfileForPremium(pool, profileId);
      if (loaded.error) return { error: loaded.error };
      const { profile } = loaded;
      if (profile.id_user !== user.id_user) return { error: "Perfil não pertence ao usuário" };

      if (await PremiumStorage.hasActiveForProfile(pool, profile.id_profile)) {
        return { error: "Este perfil já tem premium ativo" };
      }

      const pricing = await PremiumStorage.resolvePricing(pool, {
        uf: profile.estado,
        city_name: profile.municipio,
      });
      if (!pricing || !pricing.is_active) return { error: "Premium indisponível" };
      const taken = await PremiumStorage.countActiveByCity(pool, {
        uf: profile.estado,
        city_name: profile.municipio,
      });
      if (taken >= pricing.slots) return { error: "Cidade lotada — sem vagas premium disponíveis" };

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const session = await StripeService.createOneTimeCheckoutSession({
        amount_cents: pricing.price_cents,
        currency: "BRL",
        productName: `Premium - ${profile.display_name || profile.username || "Perfil"}`,
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/account?premium=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/account?premium=cancel`,
        metadata: {
          type: "premium",
          user_id: user.id_user,
          profile_id: profile.id_profile,
          duration_days: String(pricing.duration_days),
          uf: profile.estado,
          city_name: profile.municipio,
          ...(body?.coupon_code ? { coupon_code: String(body.coupon_code).trim().toUpperCase().slice(0, 40) } : {}),
        },
      });

      // Registra pending pra idempotência via UNIQUE em stripe_session_id.
      await PremiumStorage.createPending(pool, {
        profile_id: profile.id_profile,
        payment_method: "stripe",
        amount_cents: pricing.price_cents,
        stripe_session_id: session.id,
        uf: profile.estado,
        city_name: profile.municipio,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  /**
   * Webhook handler: confirma a session e ativa o premium.
   */
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "premium") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await PremiumStorage.getByStripeSession(client, session.id);
      if (existing && existing.is_active) {
        await client.query("COMMIT");
        return { premium: existing, duplicate: true };
      }

      const paymentIntent = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

      // Cota e regra "1 ativo por perfil" são checadas de novo no webhook
      // (defesa em profundidade — usuário pode ter ativo via Poléns enquanto Stripe processava).
      if (await PremiumStorage.hasActiveForProfile(client, meta.profile_id)) {
        // Se já está ativo por outro caminho, marca esta sessão como failed pra não confundir.
        if (existing?.id) await PremiumStorage.markFailed(client, existing.id);
        const refundPaymentIntent = paymentIntent;
        await client.query("COMMIT");
        if (refundPaymentIntent) {
          try {
            await StripeService.createRefundForPaymentIntent(refundPaymentIntent);
          } catch (err) {
            log.error("premium.confirm.refund_fail", { paymentIntent: refundPaymentIntent, message: err.message });
          }
        }
        return { error: "Perfil já tem premium ativo", failed_id: existing?.id };
      }

      let pending = existing;
      if (!pending) {
        pending = await PremiumStorage.createPending(client, {
          profile_id: meta.profile_id,
          payment_method: "stripe",
          amount_cents: session.amount_total || null,
          stripe_session_id: session.id,
          uf: meta.uf,
          city_name: meta.city_name,
        });
      }

      const durationDays = clampInt(meta.duration_days, { min: 1, fallback: 7 });
      const activated = await PremiumStorage.activate(client, pending.id, {
        duration_days: durationDays,
        stripe_payment_intent: paymentIntent,
      });

      await client.query("COMMIT");
      return { premium: activated };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const premium = await PremiumStorage.getByPaymentIntent(pool, paymentIntentId);
    if (!premium) return { ignored: true };
    if (premium.refunded_at) return { premium, duplicate: true };

    const updated = await PremiumStorage.markRefunded(pool, premium.id);
    return { premium: updated };
  }

  // ---------- Admin ----------

  static async adminGetSettings() {
    const settings = await PremiumStorage.getSettings(pool);
    return { settings };
  }

  static async adminUpdateSettings(body = {}) {
    return runWithLogs(log, "adminUpdateSettings", () => ({}), async () => {
      const patch = {};
      if (body.duration_days !== undefined) {
        const v = clampInt(body.duration_days, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "duration_days deve ser maior que zero" };
        patch.duration_days = v;
      }
      if (body.price_cents !== undefined) {
        const v = clampInt(body.price_cents, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "price_cents deve ser maior que zero" };
        patch.price_cents = v;
      }
      if (body.price_polens !== undefined) {
        const v = clampInt(body.price_polens, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "price_polens deve ser maior que zero" };
        patch.price_polens = v;
      }
      if (body.slots_per_city !== undefined) {
        patch.slots_per_city = clampInt(body.slots_per_city, { min: 0, fallback: 0 });
      }
      if (body.is_active !== undefined) {
        patch.is_active = body.is_active === true || body.is_active === "true";
      }
      const settings = await PremiumStorage.updateSettings(pool, patch);
      return { settings };
    });
  }

  static async adminListCityOverrides() {
    return { overrides: await PremiumStorage.listCityOverrides(pool) };
  }

  static async adminUpsertCityOverride(body = {}) {
    return runWithLogs(log, "adminUpsertCityOverride", () => ({ uf: body?.uf, city: body?.city_name }), async () => {
      const uf = String(body.uf || "").trim().toUpperCase();
      const city_name = String(body.city_name || "").trim();
      if (uf.length !== 2) return { error: "UF inválida (use sigla de 2 letras)" };
      if (!city_name) return { error: "Cidade obrigatória" };

      const price_cents = body.price_cents != null && body.price_cents !== ""
        ? clampInt(body.price_cents, { min: 1, fallback: 0 })
        : null;
      const price_polens = body.price_polens != null && body.price_polens !== ""
        ? clampInt(body.price_polens, { min: 1, fallback: 0 })
        : null;
      const slots = body.slots != null && body.slots !== ""
        ? clampInt(body.slots, { min: 0, fallback: 0 })
        : null;

      if (price_cents === 0) return { error: "price_cents deve ser maior que zero" };
      if (price_polens === 0) return { error: "price_polens deve ser maior que zero" };

      const override = await PremiumStorage.upsertCityOverride(pool, {
        uf,
        city_name,
        price_cents,
        price_polens,
        slots,
      });
      return { override };
    });
  }

  static async adminDeleteCityOverride(id) {
    return runWithLogs(log, "adminDeleteCityOverride", () => ({ id }), async () => {
      const existing = await PremiumStorage.getCityOverrideById(pool, id);
      if (!existing) return { error: "Override não encontrado" };
      await PremiumStorage.deleteCityOverride(pool, id);
      return { ok: true };
    });
  }

  static async adminListActive(query = {}) {
    return runWithLogs(log, "adminListActive", () => ({}), async () => {
      const limit = Math.min(Math.max(Number(query.per_page) || 50, 1), 200);
      const page = Math.max(1, Number(query.page) || 1);
      const offset = (page - 1) * limit;
      const q = String(query.q || "").trim();
      const items = await PremiumStorage.listActive(pool, { limit, offset, q });
      return { items, page, per_page: limit };
    });
  }
}

module.exports = PremiumService;
