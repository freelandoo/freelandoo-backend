const db = require("../databases");
const CouponStorage = require("../storages/CouponStorage");
const CouponDiscountResolver = require("./CouponDiscountResolver");
const StripeService = require("./StripeService");
const { generateCouponCode } = require("../utils/couponCode");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CouponService");

async function syncCouponToStripe(coupon) {
  try {
    const stripeCoupon = await StripeService.createCoupon({
      discount_type: coupon.discount_type,
      discount_value: coupon.value,
      max_redemptions: coupon.max_uses || null,
      expires_at: coupon.expires_at || null,
      name: `Freelandoo ${coupon.code}`,
    });
    const promo = await StripeService.createPromotionCode({
      coupon: stripeCoupon.id,
      code: coupon.code,
      expires_at: coupon.expires_at || null,
      max_redemptions: coupon.max_uses || null,
    });
    await CouponStorage.setStripeIds(db, coupon.id_coupon, {
      stripe_coupon_id: stripeCoupon.id,
      stripe_promotion_code_id: promo.id,
    });
    return { stripe_coupon_id: stripeCoupon.id, stripe_promotion_code_id: promo.id };
  } catch (err) {
    log.error("syncCouponToStripe.fail", {
      id_coupon: coupon.id_coupon,
      code: coupon.code,
      message: err?.message,
    });
    throw err;
  }
}

class CouponService {
  static validateCreatePayload(payload) {
    const {
      discount_type,
      scope,
      apply_mode,
      value,
      max_discount_cents,
      min_order_cents,
      max_uses,
      applies_to_item_id,
      expires_at,
      is_active,
    } = payload;

    if (!["percent", "amount"].includes(discount_type)) {
      const err = new Error(
        "O campo 'discount_type' deve ser 'percent' ou 'amount'."
      );
      err.statusCode = 400;
      throw err;
    }

    if (!["order", "item"].includes(scope)) {
      const err = new Error("O campo 'scope' deve ser 'order' ou 'item'.");
      err.statusCode = 400;
      throw err;
    }

    if (!["auto", "manual"].includes(apply_mode)) {
      const err = new Error(
        "O campo 'apply_mode' deve ser 'auto' ou 'manual'."
      );
      err.statusCode = 400;
      throw err;
    }

    if (value === undefined || value === null || Number.isNaN(Number(value))) {
      const err = new Error(
        "O campo 'value' é obrigatório e deve ser numérico."
      );
      err.statusCode = 400;
      throw err;
    }

    const numericValue = Number(value);

    if (
      discount_type === "percent" &&
      (numericValue < 1 || numericValue > 100)
    ) {
      const err = new Error(
        "Para desconto percentual, 'value' deve estar entre 1 e 100."
      );
      err.statusCode = 400;
      throw err;
    }

    if (discount_type === "amount" && numericValue < 1) {
      const err = new Error(
        "Para desconto em valor fixo, 'value' deve ser maior que 0."
      );
      err.statusCode = 400;
      throw err;
    }

    if (scope === "item" && !applies_to_item_id) {
      const err = new Error(
        "Quando o 'scope' for 'item', 'applies_to_item_id' é obrigatório."
      );
      err.statusCode = 400;
      throw err;
    }

    const numericFields = [
      ["max_discount_cents", max_discount_cents],
      ["min_order_cents", min_order_cents],
      ["max_uses", max_uses],
    ];

    for (const [field, fieldValue] of numericFields) {
      if (fieldValue !== undefined && fieldValue !== null) {
        const n = Number(fieldValue);
        if (Number.isNaN(n) || n < 0) {
          const err = new Error(
            `O campo '${field}' deve ser um número maior ou igual a 0.`
          );
          err.statusCode = 400;
          throw err;
        }
      }
    }

    if (expires_at) {
      const d = new Date(expires_at);
      if (Number.isNaN(d.getTime())) {
        const err = new Error("O campo 'expires_at' deve ser uma data válida.");
        err.statusCode = 400;
        throw err;
      }
    }

    if (is_active !== undefined && typeof is_active !== "boolean") {
      const err = new Error("O campo 'is_active' deve ser boolean.");
      err.statusCode = 400;
      throw err;
    }
  }

  static async create(user) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user.id_user }),
      async () => {
        const userData = await db.query(
          `SELECT nome FROM tb_user WHERE id_user = $1`,
          [user.id_user]
        );

        const nome = userData.rows[0]?.nome || "USR";

        const createPayload = {
          code: generateCouponCode({ nome, id_user: user.id_user }),

          discount_type: "percent",
          scope: "order",
          apply_mode: "manual",

          value: 30,
          max_discount_cents: 5000,
          min_order_cents: 2000,

          owner_user_id: user.id_user,

          max_uses: null,
          applies_to_item_id: null,
          expires_at: null,

          created_by: user.id_user,
          updated_by: user.id_user,

          is_active: true,
        };

        const coupon = await CouponStorage.create(db, createPayload);
        const stripeIds = await syncCouponToStripe(coupon);
        return { ...coupon, ...stripeIds };
      }
    );
  }

  static async listByUser(user, query = {}) {
    return runWithLogs(
      log,
      "listByUser",
      () => ({ id_user: user.id_user, page: query.page }),
      async () => {
        const page = Math.max(Number(query.page) || 1, 1);
        const limit = Math.max(Number(query.limit) || 10, 1);
        const offset = (page - 1) * limit;

        const filters = {
          is_active:
            query.is_active !== undefined
              ? String(query.is_active).toLowerCase() === "true"
              : undefined,
          code: query.code || undefined,
          discount_type: query.discount_type || undefined,
          scope: query.scope || undefined,
          apply_mode: query.apply_mode || undefined,
          limit,
          offset,
        };

        return await CouponStorage.listByUser(db, user.id_user, filters);
      }
    );
  }

  static async validateCoupon(payload) {
    return runWithLogs(
      log,
      "validateCoupon",
      () => ({ hasCode: !!(payload && payload.code) }),
      async () => {
        const { code, order_value_cents, item_id } = payload;

        if (!code) {
          const err = new Error("O campo 'code' é obrigatório.");
          err.statusCode = 400;
          throw err;
        }

        const coupon = await CouponStorage.findByCode(db, code);

        if (!coupon) {
          const err = new Error("Cupom não encontrado.");
          err.statusCode = 404;
          throw err;
        }

        if (!coupon.is_active) {
          throw new Error("Cupom inativo.");
        }

        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
          throw new Error("Cupom expirado.");
        }

        if (
          coupon.min_order_cents &&
          order_value_cents < coupon.min_order_cents
        ) {
          throw new Error("Valor mínimo não atingido para este cupom.");
        }

        if (coupon.scope === "item") {
          if (!item_id) {
            throw new Error(
              "Este cupom é válido apenas para itens específicos."
            );
          }

          if (coupon.applies_to_item_id !== item_id) {
            throw new Error("Cupom não aplicável a este item.");
          }
        }

        // Resolve desconto: override específico > regra geral > campos próprios do cupom
        const rule = await CouponDiscountResolver.resolve(db, coupon);
        const discount = CouponDiscountResolver.calculateDiscount({
          order_value_cents,
          rule,
        });

        return {
          valid: true,
          coupon: {
            id: coupon.id_coupon,
            code: coupon.code,
          },
          discount_cents: discount,
          final_price_cents: Math.max(order_value_cents - discount, 0),
          rule_source: rule.source,
        };
      }
    );
  }
}

module.exports = CouponService;
