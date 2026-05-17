const pool = require("../databases");
const StoreGovernanceStorage = require("../storages/StoreGovernanceStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoreGovernanceService");

// Cache 5min do singleton (raramente muda)
let SETTINGS_CACHE = { fetched_at: 0, settings: null };
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

function invalidateCache() {
  SETTINGS_CACHE = { fetched_at: 0, settings: null };
}

/**
 * Calcula as taxas e o preço final ao comprador (gross-up).
 *
 * Modelo:
 *   seller   = price_amount cravado pelo vendedor (o que ele recebe líquido)
 *   service  = max(min, min(max, seller * service_pct/100 + service_fixed))
 *   processor estimado: queremos display tal que após o processor descontar,
 *     sobre exatamente (seller + service). Como o processor é
 *     pct_p * display + fixed_p, temos:
 *       display - (pct_p/100) * display - fixed_p = seller + service
 *       display * (1 - pct_p/100) = seller + service + fixed_p
 *       display = (seller + service + fixed_p) / (1 - pct_p/100)
 *     processor_fee = display - (seller + service)
 *
 * Retorna inteiros em centavos. processor_fee_source='fallback' até o
 * webhook do Stripe substituir pelo valor real.
 */
function computeFees(sellerAmountCents, settings) {
  const seller = Math.max(0, Math.round(Number(sellerAmountCents) || 0));
  if (seller === 0) {
    return {
      seller_amount_cents: 0,
      service_fee_cents: 0,
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

  const procPct = Number(settings.processor_fee_percent_fallback) || 0;
  const procFixed = Number(settings.processor_fee_fixed_cents_fallback) || 0;

  // Gross-up
  const denom = 1 - procPct / 100;
  // se denom <= 0, configuração inválida; fallback: display = seller + service + procFixed
  let display;
  if (denom > 0.0001) {
    display = Math.ceil((seller + service_fee + procFixed) / denom);
  } else {
    display = seller + service_fee + procFixed;
  }
  const processor_fee = Math.max(0, display - seller - service_fee);

  return {
    seller_amount_cents: seller,
    service_fee_cents: service_fee,
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
  static async pricePreview(sellerCents) {
    return runWithLogs(log, "pricePreview", () => ({ sellerCents }), async () => {
      const n = Number(sellerCents);
      if (!Number.isFinite(n) || n < 0) return { error: "seller_cents inválido" };
      const settings = await getCachedSettings();
      if (!settings) return { error: "Governança não configurada" };
      const pricing = computeFees(Math.round(n), settings);
      return { pricing };
    });
  }

  /**
   * Internal: recebe seller_cents inteiro e devolve breakdown.
   * Para uso direto pelo checkout sem passar pelo cache extra.
   */
  static async computeFeesFor(sellerCents) {
    const settings = await getCachedSettings();
    if (!settings) {
      // Falha graceful: sem governança, vendedor recebe = comprador paga.
      return {
        seller_amount_cents: Math.round(Number(sellerCents) || 0),
        service_fee_cents: 0,
        processor_fee_cents: 0,
        display_price_cents: Math.round(Number(sellerCents) || 0),
        processor_fee_source: "fallback",
      };
    }
    return computeFees(Math.round(Number(sellerCents) || 0), settings);
  }
}

module.exports = StoreGovernanceService;
module.exports.computeFees = computeFees;
module.exports.invalidateCache = invalidateCache;
