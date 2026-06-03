const pool = require("../databases");
const StoreGovernanceStorage = require("../storages/StoreGovernanceStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoreGovernanceService");

// Cache 5min do singleton (raramente muda)
let SETTINGS_CACHE = { fetched_at: 0, settings: null };
let AFFILIATE_PCT_CACHE = { fetched_at: 0, percent: 0 };
const TTL_MS = 5 * 60 * 1000;

async function getCachedSettings() {
  const now = Date.now();
  if (now - SETTINGS_CACHE.fetched_at < TTL_MS && SETTINGS_CACHE.settings) {
    return SETTINGS_CACHE.settings;
  }
  const s = await StoreGovernanceStorage.get(pool);
  SETTINGS_CACHE = { fetched_at: now, settings: s };
  return s;
}

/**
 * % global de comissão de afiliado (tb_affiliate_settings.default_commission_percent).
 * É a mesma porcentagem para todo o aditivo (loja/cursos/serviços/booking).
 * Override por cupom NÃO se aplica aqui — o preço é fixado antes de saber o cupom.
 * Cacheado 5min. Falha graceful → 0 (sem comissão embutida).
 */
async function getAffiliateCommissionPercent() {
  const now = Date.now();
  if (now - AFFILIATE_PCT_CACHE.fetched_at < TTL_MS) {
    return AFFILIATE_PCT_CACHE.percent;
  }
  let percent = 0;
  try {
    const settings = await AffiliateStorage.getEffectiveSettings(pool);
    const n = Number(settings?.default_commission_percent);
    if (Number.isFinite(n) && n > 0) percent = n;
  } catch (err) {
    log.warn("affiliate_percent.fetch_fail", { message: err.message });
  }
  AFFILIATE_PCT_CACHE = { fetched_at: now, percent };
  return percent;
}

function invalidateCache() {
  SETTINGS_CACHE = { fetched_at: 0, settings: null };
  AFFILIATE_PCT_CACHE = { fetched_at: 0, percent: 0 };
}

/**
 * Calcula as taxas e o preço final ao comprador (gross-up).
 *
 * Modelo:
 *   seller    = price_amount cravado pelo vendedor (o que ele recebe líquido)
 *   service   = max(min, min(max, seller * service_pct/100 + service_fixed))
 *   afiliado  = round(seller * affiliate_pct/100) — comissão ADITIVA, embutida no
 *               preço pra TODOS os compradores (igual à taxa de serviço). Só entra
 *               quando o item tem opt-in (affiliates_allowed); aí vira comissão do
 *               afiliado se a venda veio por ?cupom=, senão a plataforma fica com ela.
 *               Base = valor do vendedor, sem frete, sem desconto.
 *   processor estimado: queremos display tal que após o processor descontar,
 *     sobre exatamente (seller + service + afiliado). Como o processor é
 *     pct_p * display + fixed_p, temos:
 *       display - (pct_p/100) * display - fixed_p = seller + service + afiliado
 *       display * (1 - pct_p/100) = seller + service + afiliado + fixed_p
 *       display = (seller + service + afiliado + fixed_p) / (1 - pct_p/100)
 *     processor_fee = display - (seller + service + afiliado)
 *
 * Retorna inteiros em centavos. processor_fee_source='fallback' até o
 * webhook do Stripe substituir pelo valor real.
 *
 * @param {Object} [opts]
 * @param {number} [opts.affiliateCommissionPercent=0] - % a embutir como comissão.
 */
function computeFees(sellerAmountCents, settings, opts = {}) {
  const seller = Math.max(0, Math.round(Number(sellerAmountCents) || 0));
  if (seller === 0) {
    return {
      seller_amount_cents: 0,
      service_fee_cents: 0,
      affiliate_commission_cents: 0,
      processor_fee_cents: 0,
      display_price_cents: 0,
      processor_fee_source: "fallback",
    };
  }

  const servicePct = Number(settings.service_fee_percent) || 0;
  const serviceFixed = Number(settings.service_fee_fixed_cents) || 0;
  const serviceMin = settings.service_fee_min_cents != null ? Number(settings.service_fee_min_cents) : null;
  const serviceMax = settings.service_fee_max_cents != null ? Number(settings.service_fee_max_cents) : null;

  let service_fee = Math.round((seller * servicePct) / 100) + serviceFixed;
  if (serviceMin != null) service_fee = Math.max(service_fee, serviceMin);
  if (serviceMax != null) service_fee = Math.min(service_fee, serviceMax);

  const affPct = Number(opts.affiliateCommissionPercent) || 0;
  const affiliate_fee = affPct > 0 ? Math.round((seller * affPct) / 100) : 0;

  const procPct = Number(settings.processor_fee_percent_fallback) || 0;
  const procFixed = Number(settings.processor_fee_fixed_cents_fallback) || 0;

  const base = seller + service_fee + affiliate_fee;

  // Gross-up
  const denom = 1 - procPct / 100;
  // se denom <= 0, configuração inválida; fallback: display = base + procFixed
  let display;
  if (denom > 0.0001) {
    display = Math.ceil((base + procFixed) / denom);
  } else {
    display = base + procFixed;
  }
  const processor_fee = Math.max(0, display - base);

  return {
    seller_amount_cents: seller,
    service_fee_cents: service_fee,
    affiliate_commission_cents: affiliate_fee,
    processor_fee_cents: processor_fee,
    display_price_cents: display,
    processor_fee_source: "fallback",
  };
}

class StoreGovernanceService {
  static invalidateCache = invalidateCache;

  static async getSettings() {
    return runWithLogs(log, "getSettings", () => ({}), async () => {
      const s = await getCachedSettings();
      if (!s) return { error: "Configuração de governança não encontrada" };
      return { settings: s };
    });
  }

  static async updateSettings(user, body) {
    return runWithLogs(log, "updateSettings", () => ({ id_user: user?.id_user }), async () => {
      const patch = {};

      if (Object.prototype.hasOwnProperty.call(body, "service_fee_percent")) {
        const n = Number(body.service_fee_percent);
        if (!Number.isFinite(n) || n < 0 || n >= 100) return { error: "service_fee_percent inválido (0..99.999)" };
        patch.service_fee_percent = n;
      }
      if (Object.prototype.hasOwnProperty.call(body, "service_fee_fixed_cents")) {
        const n = Number(body.service_fee_fixed_cents);
        if (!Number.isInteger(n) || n < 0) return { error: "service_fee_fixed_cents inválido" };
        patch.service_fee_fixed_cents = n;
      }
      for (const k of ["service_fee_min_cents", "service_fee_max_cents"]) {
        if (Object.prototype.hasOwnProperty.call(body, k)) {
          if (body[k] === null || body[k] === "") { patch[k] = null; continue; }
          const n = Number(body[k]);
          if (!Number.isInteger(n) || n < 0) return { error: `${k} inválido` };
          patch[k] = n;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, "processor_fee_mode")) {
        if (!["auto_stripe", "manual"].includes(body.processor_fee_mode)) {
          return { error: "processor_fee_mode inválido" };
        }
        patch.processor_fee_mode = body.processor_fee_mode;
      }
      if (Object.prototype.hasOwnProperty.call(body, "processor_fee_percent_fallback")) {
        const n = Number(body.processor_fee_percent_fallback);
        if (!Number.isFinite(n) || n < 0 || n >= 100) return { error: "processor_fee_percent_fallback inválido" };
        patch.processor_fee_percent_fallback = n;
      }
      if (Object.prototype.hasOwnProperty.call(body, "processor_fee_fixed_cents_fallback")) {
        const n = Number(body.processor_fee_fixed_cents_fallback);
        if (!Number.isInteger(n) || n < 0) return { error: "processor_fee_fixed_cents_fallback inválido" };
        patch.processor_fee_fixed_cents_fallback = n;
      }

      // Coerência min/max
      const current = await StoreGovernanceStorage.get(pool);
      const merged = { ...current, ...patch };
      if (merged.service_fee_min_cents != null && merged.service_fee_max_cents != null
          && merged.service_fee_min_cents > merged.service_fee_max_cents) {
        return { error: "service_fee_min_cents > service_fee_max_cents" };
      }

      if (!Object.keys(patch).length) {
        return { settings: current };
      }

      const updated = await StoreGovernanceStorage.update(pool, patch, user?.id_user);
      invalidateCache();
      return { settings: updated };
    });
  }

  /**
   * Preview de preço — usado pelo modal de cadastro de produto e pela vitrine.
   * Recebe valor que o vendedor quer receber e devolve breakdown.
   */
  static async pricePreview(sellerCents, opts = {}) {
    return runWithLogs(log, "pricePreview", () => ({ sellerCents }), async () => {
      const n = Number(sellerCents);
      if (!Number.isFinite(n) || n < 0) return { error: "seller_cents inválido" };
      const settings = await getCachedSettings();
      if (!settings) return { error: "Governança não configurada" };
      const affiliateCommissionPercent = opts.affiliatesAllowed
        ? await getAffiliateCommissionPercent()
        : 0;
      const pricing = computeFees(Math.round(n), settings, { affiliateCommissionPercent });
      return { pricing };
    });
  }

  /**
   * Internal: recebe seller_cents inteiro e devolve breakdown.
   * Para uso direto pelo checkout sem passar pelo cache extra.
   *
   * @param {number} sellerCents
   * @param {Object} [opts]
   * @param {boolean} [opts.affiliatesAllowed=false] - item com opt-in de afiliado;
   *   quando true, embute a comissão aditiva no display.
   */
  static async computeFeesFor(sellerCents, opts = {}) {
    const seller = Math.round(Number(sellerCents) || 0);
    const affiliateCommissionPercent = opts.affiliatesAllowed
      ? await getAffiliateCommissionPercent()
      : 0;
    const settings = await getCachedSettings();
    if (!settings) {
      // Falha graceful: sem governança, vendedor recebe = comprador paga, mas a
      // comissão aditiva (se opt-in) ainda é embutida no display.
      const affiliate_fee = affiliateCommissionPercent > 0
        ? Math.round((seller * affiliateCommissionPercent) / 100)
        : 0;
      return {
        seller_amount_cents: seller,
        service_fee_cents: 0,
        affiliate_commission_cents: affiliate_fee,
        processor_fee_cents: 0,
        display_price_cents: seller + affiliate_fee,
        processor_fee_source: "fallback",
      };
    }
    return computeFees(seller, settings, { affiliateCommissionPercent });
  }
}

module.exports = StoreGovernanceService;
module.exports.computeFees = computeFees;
module.exports.invalidateCache = invalidateCache;
module.exports.getAffiliateCommissionPercent = getAffiliateCommissionPercent;
