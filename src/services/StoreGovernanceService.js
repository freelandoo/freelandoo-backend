const pool = require("../databases");
const StoreGovernanceStorage = require("../storages/StoreGovernanceStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoreGovernanceService");

// Cache 5min do singleton (raramente muda)
let SETTINGS_CACHE = { fetched_at: 0, settings: null };
let AFFILIATE_PCT_CACHE = { fetched_at: 0, percent: 0 };
let PROGRAM_CACHE = { fetched_at: 0, settings: null };
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
 * Trilhos globais do programa de afiliados (mig 192): split, teto/piso do que o
 * dono pode destinar e o default de quem não definiu nada. Cacheado 5min.
 * Falha graceful → null (o chamador cai no default legado).
 */
async function getProgramSettings() {
  const now = Date.now();
  if (now - PROGRAM_CACHE.fetched_at < TTL_MS && PROGRAM_CACHE.settings) {
    return PROGRAM_CACHE.settings;
  }
  let settings = null;
  try {
    settings = await AffiliateProgramStorage.getSettings(pool);
  } catch (err) {
    log.warn("affiliate_program.fetch_fail", { message: err.message });
  }
  PROGRAM_CACHE = { fetched_at: now, settings };
  return settings;
}

/**
 * % PADRÃO de afiliado — vale para o item que não definiu a própria
 * (affiliate_percent NULL) e para os contextos em que a % é do admin.
 *
 * Fonte: tb_affiliate_program_settings.default_percent (mig 192), com fallback
 * na regra legada tb_affiliate_settings.default_commission_percent enquanto a
 * migration não tiver rodado. Cacheado 5min; falha graceful → 0.
 */
async function getAffiliateCommissionPercent() {
  const now = Date.now();
  if (now - AFFILIATE_PCT_CACHE.fetched_at < TTL_MS) {
    return AFFILIATE_PCT_CACHE.percent;
  }
  let percent = 0;
  try {
    const program = await getProgramSettings();
    const p = Number(program?.default_percent);
    if (Number.isFinite(p) && p > 0) {
      percent = p;
    } else {
      const settings = await AffiliateStorage.getEffectiveSettings(pool);
      const n = Number(settings?.default_commission_percent);
      if (Number.isFinite(n) && n > 0) percent = n;
    }
  } catch (err) {
    log.warn("affiliate_percent.fetch_fail", { message: err.message });
  }
  AFFILIATE_PCT_CACHE = { fetched_at: now, percent };
  return percent;
}

/**
 * Resolve a % de afiliado de UM item (regime 'user': loja/curso/serviço/booking).
 *
 * O dono é quem decide (`itemPercent`); NULL/indefinido cai no default global.
 * O valor é sempre grampeado nos trilhos do admin — sem isso um dono poderia
 * destinar 90% e distorcer o preço final do site.
 *
 * Sem opt-in (`affiliates_allowed`) não existe pool: retorna 0 e o preço do item
 * fica idêntico ao de antes do programa.
 *
 * @param {Object} opts
 * @param {boolean} [opts.affiliatesAllowed=false]
 * @param {number|string|null} [opts.affiliatePercent] - % do próprio item
 * @returns {Promise<number>} percentual (0..100)
 */
async function resolveAffiliatePercent({ affiliatesAllowed = false, affiliatePercent = null } = {}) {
  if (!affiliatesAllowed) return 0;

  const own = Number(affiliatePercent);
  const hasOwn = affiliatePercent !== null && affiliatePercent !== undefined
    && affiliatePercent !== "" && Number.isFinite(own) && own >= 0;

  const percent = hasOwn ? own : await getAffiliateCommissionPercent();
  if (!(percent > 0)) return 0;

  const program = await getProgramSettings();
  const min = Number(program?.seller_percent_min);
  const max = Number(program?.seller_percent_max);
  let clamped = percent;
  if (Number.isFinite(min) && clamped < min) clamped = min;
  if (Number.isFinite(max) && clamped > max) clamped = max;
  return clamped;
}

function invalidateCache() {
  SETTINGS_CACHE = { fetched_at: 0, settings: null };
  AFFILIATE_PCT_CACHE = { fetched_at: 0, percent: 0 };
  PROGRAM_CACHE = { fetched_at: 0, settings: null };
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
   * Trilhos do programa de afiliados para o front (piso, teto e default da % que
   * o dono do item pode destinar). Falha graceful → valores conservadores.
   */
  static async getAffiliateProgram() {
    return runWithLogs(log, "getAffiliateProgram", () => ({}), async () => {
      const s = await getProgramSettings();
      const fallbackDefault = await getAffiliateCommissionPercent();
      return {
        program: {
          seller_percent_min: Number(s?.seller_percent_min ?? 0),
          seller_percent_max: Number(s?.seller_percent_max ?? 50),
          default_percent: Number(s?.default_percent ?? fallbackDefault ?? 0),
          commission_split_percent: Number(s?.commission_split_percent ?? 100),
        },
      };
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
      const affiliateCommissionPercent = await resolveAffiliatePercent({
        affiliatesAllowed: opts.affiliatesAllowed,
        affiliatePercent: opts.affiliatePercent,
      });
      const pricing = computeFees(Math.round(n), settings, { affiliateCommissionPercent });
      return { pricing: { ...pricing, affiliate_percent: affiliateCommissionPercent } };
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
   * @param {number|null} [opts.affiliatePercent] - % definida pelo DONO do item
   *   (mig 192). NULL/ausente cai no default global. Sempre grampeada nos trilhos.
   */
  static async computeFeesFor(sellerCents, opts = {}) {
    const seller = Math.round(Number(sellerCents) || 0);
    const affiliateCommissionPercent = await resolveAffiliatePercent({
      affiliatesAllowed: opts.affiliatesAllowed,
      affiliatePercent: opts.affiliatePercent,
    });
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
        affiliate_percent: affiliateCommissionPercent,
      };
    }
    return {
      ...computeFees(seller, settings, { affiliateCommissionPercent }),
      affiliate_percent: affiliateCommissionPercent,
    };
  }
}

module.exports = StoreGovernanceService;
module.exports.computeFees = computeFees;
module.exports.invalidateCache = invalidateCache;
module.exports.getAffiliateCommissionPercent = getAffiliateCommissionPercent;
module.exports.getProgramSettings = getProgramSettings;
module.exports.resolveAffiliatePercent = resolveAffiliatePercent;
