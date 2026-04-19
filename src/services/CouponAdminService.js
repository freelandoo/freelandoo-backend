const db = require("../databases");
const CouponAdminStorage = require("../storages/CouponAdminStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateService = require("./AffiliateService");
const { resolve: resolveDiscount } = require("./CouponDiscountResolver");

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function validateDiscountPayload(body) {
  const { discount_type, discount_value, max_discount_cents } = body || {};
  if (!["percent", "amount"].includes(discount_type)) {
    throw new ServiceError("discount_type deve ser 'percent' ou 'amount'", 400);
  }
  const value = Number(discount_value);
  if (!Number.isFinite(value) || value < 0) {
    throw new ServiceError("discount_value deve ser um número >= 0", 400);
  }
  if (discount_type === "percent" && value > 100) {
    throw new ServiceError("discount_value percentual deve estar entre 0 e 100", 400);
  }
  if (
    max_discount_cents != null &&
    (!Number.isFinite(Number(max_discount_cents)) || Number(max_discount_cents) < 0)
  ) {
    throw new ServiceError("max_discount_cents inválido", 400);
  }
}

// ───────── Discount settings (geral) ─────────
async function getDiscountSettings() {
  const row = await CouponAdminStorage.getEffectiveDiscountSettings(db);
  return { settings: row };
}

async function listDiscountSettings() {
  return await CouponAdminStorage.listDiscountSettings(db);
}

async function createDiscountSettings(actor, body) {
  validateDiscountPayload(body);
  const row = await CouponAdminStorage.createDiscountSettings(db, {
    discount_type: body.discount_type,
    discount_value: Number(body.discount_value),
    max_discount_cents:
      body.max_discount_cents != null && body.max_discount_cents !== ""
        ? Number(body.max_discount_cents)
        : null,
    is_active: body.is_active !== false,
    notes: body.notes || null,
    created_by: actor.id_user,
  });
  return row;
}

// ───────── Commission settings (geral) — reusa tb_affiliate_settings ─────────
async function getCommissionSettings() {
  const row = await AffiliateStorage.getEffectiveSettings(db);
  return { settings: row };
}

async function createCommissionSettings(actor, body) {
  // normaliza shape do UI (percent/value → default_commission_percent)
  const payload = {
    default_commission_percent:
      body.default_commission_percent ?? body.value ?? body.percent,
    commission_base: body.commission_base || "NET_OF_DISCOUNT",
    min_order_cents: body.min_order_cents || 0,
    max_commission_cents:
      body.max_commission_cents != null && body.max_commission_cents !== ""
        ? Number(body.max_commission_cents)
        : null,
    approval_delay_days: body.approval_delay_days ?? 30,
    notes: body.notes || null,
  };
  return await AffiliateService.createSettings(actor, payload);
}

// ───────── Busca de cupom (admin) ─────────
async function searchCoupon(code) {
  if (!code || !code.trim()) {
    throw new ServiceError("code obrigatório", 400);
  }
  const coupon = await CouponAdminStorage.searchByCode(db, code.trim());
  if (!coupon) {
    throw new ServiceError("Cupom não encontrado", 404);
  }

  const discountOverride = await CouponAdminStorage.getDiscountOverride(db, coupon.id_coupon);
  const commissionOverride = await AffiliateStorage.getCouponOverride(db, coupon.id_coupon);

  const resolvedDiscount = await resolveDiscount(db, coupon);
  const generalDiscount = await CouponAdminStorage.getEffectiveDiscountSettings(db);
  const generalCommission = await AffiliateStorage.getEffectiveSettings(db);

  return {
    coupon,
    discount: {
      override: discountOverride,
      general: generalDiscount,
      effective: resolvedDiscount, // { discount_type, discount_value, max_discount_cents, source }
    },
    commission: {
      override: commissionOverride,
      general: generalCommission,
      effective_percent:
        commissionOverride?.commission_percent != null
          ? Number(commissionOverride.commission_percent)
          : generalCommission
            ? Number(generalCommission.default_commission_percent)
            : null,
      source: commissionOverride ? "override" : generalCommission ? "general" : "none",
    },
  };
}

// ───────── Override de desconto por cupom ─────────
async function upsertDiscountOverride(actor, id_coupon, body) {
  if (!id_coupon) throw new ServiceError("id_coupon obrigatório", 400);
  validateDiscountPayload(body);
  const row = await CouponAdminStorage.upsertDiscountOverride(db, {
    id_coupon,
    discount_type: body.discount_type,
    discount_value: Number(body.discount_value),
    max_discount_cents:
      body.max_discount_cents != null && body.max_discount_cents !== ""
        ? Number(body.max_discount_cents)
        : null,
    created_by: actor.id_user,
    updated_by: actor.id_user,
  });
  return row;
}

async function deleteDiscountOverride(actor, id_coupon) {
  if (!id_coupon) throw new ServiceError("id_coupon obrigatório", 400);
  return await CouponAdminStorage.deleteDiscountOverride(db, id_coupon);
}

// ───────── Override de comissão por cupom — reusa tb_affiliate_coupon_override ─────────
async function upsertCommissionOverride(actor, id_coupon, body) {
  if (!id_coupon) throw new ServiceError("id_coupon obrigatório", 400);
  return await AffiliateService.upsertCouponOverride(actor, id_coupon, body);
}

async function deleteCommissionOverride(actor, id_coupon) {
  if (!id_coupon) throw new ServiceError("id_coupon obrigatório", 400);
  return await AffiliateService.deleteCouponOverride(actor, id_coupon);
}

module.exports = {
  ServiceError,
  getDiscountSettings,
  listDiscountSettings,
  createDiscountSettings,
  getCommissionSettings,
  createCommissionSettings,
  searchCoupon,
  upsertDiscountOverride,
  deleteDiscountOverride,
  upsertCommissionOverride,
  deleteCommissionOverride,
};
