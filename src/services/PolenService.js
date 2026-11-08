const crypto = require("crypto");
const pool = require("../databases");
const PolenStorage = require("../storages/PolenStorage");
const EmeraldService = require("./EmeraldService");
const { emeraldPrice, parseCurrency } = require("../utils/currency");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PolenService");

const PRODUCTS = {
  profile_activation: {
    tx: "spend_profile_activation",
    priceKey: "price_profile_activation",
    requiresTarget: true,
  },
  // A7: os DESTAQUES também se pagam em Esmeralda (emeraldKey: NULL = Gold × 1.000).
  premium_highlight: { tx: "spend_premium_highlight", priceKey: "price_premium_highlight", emeraldKey: "emerald_price_premium_highlight" },
  post_boost: { tx: "spend_post_boost", priceKey: "price_post_boost" },
  profile_boost: { tx: "spend_profile_boost", priceKey: "price_profile_boost" },
  clan_highlight: { tx: "spend_clan_highlight", priceKey: "price_clan_highlight", emeraldKey: "emerald_price_clan_highlight" },
};

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function minutesUntil(date) {
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 60000));
}

function walletPayload(wallet, settings, usage, emerald) {
  return {
    // A7: `wallet` é a carteira de GOLD (o antigo Pólen, 1 Gold = R$ 1);
    // `emerald` é a Verde Esmeralda (anúncio e nível pagam nela).
    wallet,
    emerald,
    limits: {
      ads_per_day: settings.ads_per_day_per_user,
      polens_per_ad: settings.polens_per_ad,
      daily_polens_limit: settings.daily_polens_limit,
      cooldown_seconds: settings.cooldown_seconds,
      ads_watched_today: usage.ads || 0,
      polens_earned_today: usage.polens || 0,
      system_active: !!settings.is_active,
    },
    prices: {
      price_profile_activation: settings.price_profile_activation,
      price_premium_highlight: settings.price_premium_highlight,
      price_post_boost: settings.price_post_boost,
      price_profile_boost: settings.price_profile_boost,
      price_clan_highlight: settings.price_clan_highlight,
      emerald_price_premium_highlight: emeraldPrice(settings.price_premium_highlight, settings.emerald_price_premium_highlight),
      emerald_price_clan_highlight: emeraldPrice(settings.price_clan_highlight, settings.emerald_price_clan_highlight),
    },
    manifestation: {
      admin_enabled: settings.manifestation_admin_enabled !== false,
      users_enabled: settings.manifestation_users_enabled !== false,
      min_xp_level: Number(settings.manifestation_min_xp_level) || 0,
    },
  };
}

class PolenService {
  static async getWallet(user) {
    return runWithLogs(log, "getWallet", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const [settings, wallet, usage, emerald] = await Promise.all([
        PolenStorage.getSettings(pool),
        PolenStorage.getOrCreateWallet(pool, user.id_user),
        PolenStorage.countRewardedToday(pool, user.id_user),
        EmeraldService.summary(pool, user.id_user),
      ]);
      return walletPayload(wallet, settings, usage, emerald);
    });
  }

  static async history(user, query) {
    return runWithLogs(log, "history", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const limit = Math.min(Math.max(Number(query?.limit) || 30, 1), 100);
      const offset = Math.max(Number(query?.offset) || 0, 0);
      const transactions = await PolenStorage.listTransactions(pool, user.id_user, { limit, offset });
      return { transactions, limit, offset };
    });
  }

  static async requestRewardedAd(user, req) {
    return runWithLogs(log, "requestRewardedAd", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const settings = await PolenStorage.getSettings(pool);
      if (!settings?.is_active) return { error: "Sistema de Poléns inativo" };
      const usage = await PolenStorage.countRewardedToday(pool, user.id_user);
      if (usage.ads >= settings.ads_per_day_per_user || usage.polens >= settings.daily_polens_limit) {
        return {
          error: "Você atingiu o limite de anúncios de hoje. Volte amanhã para ganhar mais Poléns.",
          code: "daily_limit",
        };
      }
      if (usage.last_event_at) {
        const nextAt = new Date(new Date(usage.last_event_at).getTime() + settings.cooldown_seconds * 1000);
        if (nextAt.getTime() > Date.now()) {
          return {
            error: `Você poderá assistir outro anúncio em ${minutesUntil(nextAt)} minutos.`,
            code: "cooldown",
            next_available_at: nextAt.toISOString(),
          };
        }
      }
      const reward = Math.min(
        settings.polens_per_ad,
        Math.max(settings.daily_polens_limit - usage.polens, 0)
      );
      if (reward <= 0) return { error: "Limite diário de Poléns atingido", code: "daily_limit" };
      const token = crypto.randomUUID();
      const event = await PolenStorage.createRewardEvent(pool, {
        user_id: user.id_user,
        provider: settings.rewarded_provider || "mock",
        ad_unit_id: settings.rewarded_ad_unit_id || null,
        reward_token: token,
        reward_amount: reward,
        ip_hash: hashValue(req?.ip || req?.headers?.["x-forwarded-for"]),
        user_agent_hash: hashValue(req?.headers?.["user-agent"]),
        metadata: { provider_mode: settings.rewarded_provider || "mock" },
      });
      return {
        event,
        reward_token: token,
        reward_amount: reward,
        provider: event.provider,
        ad_unit_id: event.ad_unit_id,
        currency: "emerald",
        message: `Assista a um anúncio para ganhar ${reward} Esmeraldas.`,
      };
    });
  }

  static async completeRewardedAd(user, body) {
    return runWithLogs(log, "completeRewardedAd", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const token = body?.reward_token;
      if (!token) return { error: "reward_token obrigatório" };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const event = await PolenStorage.getRewardEventByToken(client, token);
        if (!event || String(event.user_id) !== String(user.id_user)) {
          await client.query("ROLLBACK");
          return { error: "Evento de recompensa inválido" };
        }
        if (event.status === "rewarded") {
          await client.query("ROLLBACK");
          return { error: "Recompensa já creditada" };
        }
        const rewarded = await PolenStorage.markRewarded(client, token);
        if (!rewarded) {
          await client.query("ROLLBACK");
          return { error: "Evento expirado ou inválido" };
        }
        // A7: anúncio assistido paga ESMERALDA (mesmos limites de antes).
        const result = await EmeraldService.grant(client, {
          user_id: user.id_user,
          amount: rewarded.reward_amount,
          type: "earn_rewarded_ad",
          source: "rewarded_ad",
          source_id: rewarded.id,
          metadata: { reward_token: token, provider: rewarded.provider },
        });
        if (!result) {
          await client.query("ROLLBACK");
          return { error: "Recompensa já creditada" };
        }
        await client.query("COMMIT");
        return { emerald_wallet: result.wallet, transaction: result.transaction, rewarded: result.transaction.amount, currency: "emerald" };
      } catch (err) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") return { error: "Recompensa duplicada" };
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async spend(user, body) {
    return runWithLogs(log, "spend", () => ({ id_user: user?.id_user, product: body?.product }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const product = PRODUCTS[body?.product];
      if (!product) return { error: "Produto inválido" };
      const currency = parseCurrency(body?.currency);
      if (!currency) return { error: "Moeda inválida" };
      if (currency === "emerald" && !product.emeraldKey) {
        return { error: "Este produto só se paga com Gold" };
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const settings = await PolenStorage.getSettings(client);
        if (!settings?.is_active) {
          await client.query("ROLLBACK");
          return { error: "Sistema de Poléns inativo" };
        }
        const amount = currency === "emerald"
          ? emeraldPrice(settings[product.priceKey], settings[product.emeraldKey])
          : Number(settings[product.priceKey]) || 0;
        if (amount <= 0) {
          await client.query("ROLLBACK");
          return { error: "Produto sem preço configurado" };
        }
        let benefit = { status: "reserved", product: body.product, currency };
        if (body.product === "profile_activation") {
          if (!body.target_id) {
            await client.query("ROLLBACK");
            return { error: "target_id obrigatório para ativar perfil" };
          }
          const sub = await PolenStorage.activateProfileWithPolens(client, {
            user_id: user.id_user,
            id_profile: body.target_id,
            amount,
          });
          if (!sub) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }
          benefit = { status: "activated", product: body.product, id_subscription: sub.id_subscription };
        }
        const debitArgs = {
          user_id: user.id_user,
          amount,
          type: product.tx,
          source: "polen_store",
          source_id: `${body.product}:${body.target_id || crypto.randomUUID()}`,
          metadata: { product: body.product, target_id: body.target_id || null, benefit },
        };
        let result;
        if (currency === "emerald") {
          result = await EmeraldService.charge(client, debitArgs);
        } else {
          const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);
          result = await PolenStorage.debit(client, { ...debitArgs, wallet_id: wallet.id });
        }
        if (!result) {
          await client.query("ROLLBACK");
          return { error: "Saldo insuficiente" };
        }
        await client.query("COMMIT");
        return currency === "emerald"
          ? { emerald_wallet: result.wallet, transaction: result.transaction, benefit, currency }
          : { wallet: result.wallet, transaction: result.transaction, benefit, currency };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async getAdminSettings() {
    return { settings: await PolenStorage.getSettings(pool) };
  }

  static async updateAdminSettings(user, body) {
    const numeric = [
      "polens_per_ad",
      "ads_per_day_per_user",
      "cooldown_seconds",
      "daily_polens_limit",
      "price_profile_activation",
      "price_premium_highlight",
      "price_post_boost",
      "price_profile_boost",
      "price_clan_highlight",
      "manifestation_min_xp_level",
    ];
    // Preço em Esmeralda dos destaques: null/"" = volta à regra (Gold × 1.000).
    const emeraldKeys = ["emerald_price_premium_highlight", "emerald_price_clan_highlight"];
    const patch = { updated_by: user?.id_user || null };
    for (const key of numeric) {
      if (body[key] != null) {
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0) return { error: `${key} inválido` };
        patch[key] = Math.floor(n);
      }
    }
    for (const key of emeraldKeys) {
      if (body[key] === null || body[key] === "") patch[key] = null;
      else if (body[key] != null) {
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0) return { error: `${key} inválido` };
        patch[key] = Math.floor(n);
      }
    }
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (typeof body.manifestation_admin_enabled === "boolean") {
      patch.manifestation_admin_enabled = body.manifestation_admin_enabled;
    }
    if (typeof body.manifestation_users_enabled === "boolean") {
      patch.manifestation_users_enabled = body.manifestation_users_enabled;
    }
    if (body.rewarded_provider != null) patch.rewarded_provider = String(body.rewarded_provider).slice(0, 60);
    if (body.rewarded_ad_unit_id !== undefined) patch.rewarded_ad_unit_id = body.rewarded_ad_unit_id ? String(body.rewarded_ad_unit_id).slice(0, 180) : null;
    return { settings: await PolenStorage.updateSettings(pool, patch) };
  }

  static async metrics() {
    const metrics = await PolenStorage.metrics(pool);
    const requested = Number(metrics.ads_requested_today) || 0;
    const completed = Number(metrics.ads_completed_today) || 0;
    return {
      metrics: {
        ...metrics,
        completion_rate: requested > 0 ? completed / requested : 0,
        estimated_reward_cost: Number(metrics.polens_issued_today) || 0,
      },
    };
  }
}

module.exports = PolenService;
