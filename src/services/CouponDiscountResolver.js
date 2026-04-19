const CouponAdminStorage = require("../storages/CouponAdminStorage");

/**
 * Resolve o desconto vigente para um cupom.
 *
 * Prioridade:
 *   1. override específico (tb_coupon_discount_override.is_active)
 *   2. regra geral ativa (tb_coupon_discount_settings.is_active)
 *   3. fallback → campos do próprio tb_coupon (compat. com coupons criados por usuários)
 *
 * Retorna { discount_type, discount_value, max_discount_cents, source }.
 */
async function resolve(conn, coupon) {
  const override = await CouponAdminStorage.getDiscountOverride(conn, coupon.id_coupon);
  if (
    override &&
    override.discount_type != null &&
    override.discount_value != null
  ) {
    return {
      discount_type: override.discount_type,
      discount_value: Number(override.discount_value),
      max_discount_cents: override.max_discount_cents,
      source: "override",
    };
  }

  const settings = await CouponAdminStorage.getEffectiveDiscountSettings(conn);
  if (settings && settings.is_active) {
    return {
      discount_type: settings.discount_type,
      discount_value: Number(settings.discount_value),
      max_discount_cents: settings.max_discount_cents,
      source: "general",
    };
  }

  return {
    discount_type: coupon.discount_type,
    discount_value: Number(coupon.value),
    max_discount_cents: coupon.max_discount_cents,
    source: "coupon_self",
  };
}

// Convenção: discount_value é percentual (0-100) quando type='percent' e
// cents (inteiro) quando type='amount'. Consistente em override, settings e tb_coupon.
function calculateDiscount({ order_value_cents, rule }) {
  let discount = 0;
  if (rule.discount_type === "percent") {
    discount = (order_value_cents * rule.discount_value) / 100;
  } else {
    discount = rule.discount_value;
  }
  if (rule.max_discount_cents != null) {
    discount = Math.min(discount, rule.max_discount_cents);
  }
  return Math.floor(discount);
}

module.exports = { resolve, calculateDiscount };
