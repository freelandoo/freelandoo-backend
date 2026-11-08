// A7 — Verde Esmeralda: carteira, histórico, conversão Gold → Esmeralda e o
// crédito único usado por todas as fontes grátis (nível, anúncio, meta,
// engajamento). Esmeralda NUNCA vira Gold: não existe rota nem função para isso.
const crypto = require("crypto");
const pool = require("../databases");
const PolenStorage = require("../storages/PolenStorage");
const EmeraldStorage = require("../storages/EmeraldStorage");
const { EMERALD_PER_GOLD } = require("../utils/currency");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("EmeraldService");
const MAX_CONVERT_GOLD = 100000;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

class EmeraldService {
  /** Resumo da carteira de Esmeralda + regras visíveis. */
  static async summary(conn, user_id) {
    const [wallet, settings] = await Promise.all([
      EmeraldStorage.getOrCreateWallet(conn, user_id),
      EmeraldStorage.getSettings(conn),
    ]);
    const engagedToday = await EmeraldStorage.sumToday(conn, user_id, ["earn_engagement", "earn_reach"]);
    return {
      wallet,
      emerald_per_gold: EMERALD_PER_GOLD,
      conversion_enabled: settings?.conversion_enabled !== false,
      engagement: {
        enabled: settings?.engagement_enabled !== false,
        daily_cap: Number(settings?.engagement_daily_cap) || 0,
        earned_today: Math.max(0, engagedToday),
        points: {
          like: settings?.points_like ?? 1,
          save: settings?.points_save ?? 2,
          comment: settings?.points_comment ?? 3,
          share: settings?.points_share ?? 5,
        },
      },
    };
  }

  static async history(user, query) {
    return runWithLogs(log, "history", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const limit = Math.min(Math.max(Number(query?.limit) || 30, 1), 100);
      const offset = Math.max(Number(query?.offset) || 0, 0);
      const transactions = await EmeraldStorage.listTransactions(pool, user.id_user, { limit, offset });
      return { transactions, limit, offset };
    });
  }

  /**
   * Gold → Esmeralda (1:1.000), transação dupla atômica. `key` é a chave de
   * idempotência do aparelho: clique duplo ou reenvio devolvem a mesma troca.
   */
  static async convert(user, body) {
    return runWithLogs(log, "convert", () => ({ id_user: user?.id_user, gold: body?.gold }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const gold = Math.floor(Number(body?.gold));
      if (!Number.isFinite(gold) || gold <= 0 || gold !== Number(body?.gold)) {
        return { error: "Quantidade de Gold inválida" };
      }
      if (gold > MAX_CONVERT_GOLD) return { error: "Quantidade de Gold acima do limite por conversão" };
      const key = body?.key ? String(body.key) : crypto.randomUUID();
      if (!KEY_RE.test(key)) return { error: "Chave inválida" };
      const sourceId = `${user.id_user}:${key}`;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const settings = await EmeraldStorage.getSettings(client);
        if (settings?.conversion_enabled === false) {
          await client.query("ROLLBACK");
          return { error: "Conversão desligada no momento", statusCode: 409 };
        }
        const emeraldWallet = await EmeraldStorage.lockWallet(client, user.id_user);
        const done = await EmeraldStorage.findPosted(client, "gold_conversion", sourceId);
        if (done) {
          await client.query("COMMIT");
          const goldWallet = await PolenStorage.getWallet(pool, user.id_user);
          return { replay: true, gold: Math.abs(done.amount) / EMERALD_PER_GOLD, emerald: done.amount, gold_wallet: goldWallet, emerald_wallet: emeraldWallet };
        }
        const goldWallet = await PolenStorage.getOrCreateWallet(client, user.id_user);
        const debit = await PolenStorage.debit(client, {
          user_id: user.id_user,
          wallet_id: goldWallet.id,
          amount: gold,
          type: "spend_emerald_conversion",
          source: "emerald_conversion",
          source_id: sourceId,
          metadata: { emerald: gold * EMERALD_PER_GOLD, rate: EMERALD_PER_GOLD },
        });
        if (!debit) {
          await client.query("ROLLBACK");
          return { error: "Saldo de Gold insuficiente", statusCode: 402 };
        }
        const credit = await EmeraldStorage.credit(client, {
          user_id: user.id_user,
          wallet_id: emeraldWallet.id,
          amount: gold * EMERALD_PER_GOLD,
          type: "earn_gold_conversion",
          source: "gold_conversion",
          source_id: sourceId,
          metadata: { gold, rate: EMERALD_PER_GOLD, gold_tx: debit.transaction.id },
        });
        if (!credit) throw new Error("conversão sem crédito de Esmeralda");
        await client.query("COMMIT");
        return {
          replay: false,
          gold,
          emerald: gold * EMERALD_PER_GOLD,
          gold_wallet: debit.wallet,
          emerald_wallet: credit.wallet,
        };
      } catch (err) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") return { error: "Conversão duplicada", statusCode: 409 };
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Crédito de fonte grátis, na transação de quem chama. Idempotente por
   * (source, source_id). Devolve o resultado do ledger ou null (já creditado).
   */
  static async grant(conn, { user_id, amount, type, source, source_id, metadata }) {
    const wallet = await EmeraldStorage.getOrCreateWallet(conn, user_id);
    return EmeraldStorage.credit(conn, { user_id, wallet_id: wallet.id, amount, type, source, source_id, metadata });
  }

  /** Débito na transação de quem chama. null = saldo insuficiente. */
  static async charge(conn, { user_id, amount, type, source, source_id, metadata }) {
    const wallet = await EmeraldStorage.getOrCreateWallet(conn, user_id);
    return EmeraldStorage.debit(conn, { user_id, wallet_id: wallet.id, amount, type, source, source_id, metadata });
  }

  static async getAdminSettings() {
    return { settings: await EmeraldStorage.getSettings(pool) };
  }

  static async updateAdminSettings(user, body) {
    const numeric = [
      "engagement_daily_cap", "work_daily_cap",
      "points_like", "points_save", "points_comment", "points_share",
      "comment_min_chars", "reach_points_per_emerald", "coupon_gold_per_10_brl",
    ];
    const patch = { updated_by: user?.id_user || null };
    for (const key of numeric) {
      if (body?.[key] != null) {
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0) return { error: `${key} inválido` };
        if ((key === "reach_points_per_emerald" || key === "coupon_gold_per_10_brl") && n < 1) return { error: `${key} inválido` };
        patch[key] = Math.floor(n);
      }
    }
    for (const key of ["is_active", "conversion_enabled", "engagement_enabled"]) {
      if (typeof body?.[key] === "boolean") patch[key] = body[key];
    }
    return { settings: await EmeraldStorage.updateSettings(pool, patch) };
  }
}

module.exports = EmeraldService;
