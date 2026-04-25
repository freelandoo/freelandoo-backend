const pool = require("../databases");
const CheckoutStorage = require("../storages/CheckoutStorage");
const ProfileStorage = require("../storages/ProfileStorage");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const { createLogger, runWithLogs } = require("../utils/logger");
const log = createLogger("CheckoutService");

class CheckoutService {
  static async resolveOptionalProfileId(poolRef, raw) {
    return runWithLogs(
      log,
      "resolveOptionalProfileId",
      () => ({ hasRaw: raw !== undefined && raw !== null }),
      async () => {
        if (raw === undefined || raw === null) {
          return { id_profile: null };
        }
        const s = String(raw).trim();
        if (!s) {
          return { id_profile: null };
        }
        if (!UUID_RE.test(s)) {
          return { error: "id_profile inválido" };
        }
        const profile = await ProfileStorage.getProfileById(poolRef, s);
        if (!profile) {
          return { error: "Perfil não encontrado" };
        }
        return { id_profile: s };
      }
    );
  }

  static async createCheckout(user, body) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user.id_user, id_item: body?.id_item }),
      async () => {
        const { id_item, id_profile: rawProfile } = body || {};

        if (!id_item) {
          return { error: "id_item é obrigatório" };
        }

        const item = await CheckoutStorage.getItemById(pool, id_item);

        if (!item) {
          return { error: "Item não encontrado" };
        }

        if (!item.is_active) {
          return { error: "Item inativo" };
        }

        const profileResolved =
          await CheckoutService.resolveOptionalProfileId(pool, rawProfile);
        if (profileResolved.error) {
          return { error: profileResolved.error };
        }

        const subtotal = Number(item.unity_price_cents || 0);
        const total = subtotal;

        const checkout = await CheckoutStorage.createCheckout(pool, {
          id_user: user.id_user,
          subtotal_cents: subtotal,
          discount_cents: 0,
          total_cents: total,
          currency: item.currency || "BRL",
          id_profile: profileResolved.id_profile,
        });

        await CheckoutStorage.createCheckoutItem(pool, {
          id_checkout: checkout.id_checkout,
          id_item,
          item_name_snapshot: item.desc_item,
          unit_price_cents_snapshot: subtotal,
          quantity: 1,
          total_cents: total,
          discount_cents: 0,
        });

        const summary = await CheckoutStorage.getCheckoutSummary(
          pool,
          checkout.id_checkout
        );

        return { checkout: summary };
      }
    );
  }

  static async getCheckoutById(user, params) {
    return runWithLogs(
      log,
      "getCheckoutById",
      () => ({ id_user: user.id_user, id_checkout: params?.id_checkout }),
      async () => {
        const { id_checkout } = params || {};

        if (!id_checkout) {
          return { error: "id_checkout é obrigatório" };
        }

        const summary = await CheckoutStorage.getCheckoutSummary(
          pool,
          id_checkout
        );

        if (!summary) {
          return { error: "Checkout não encontrado" };
        }

        if (summary.id_user !== user.id_user) {
          return { error: "Você não tem permissão para acessar este checkout" };
        }

        return { checkout: summary };
      }
    );
  }

  static async applyCoupon(user, params, body) {
    return runWithLogs(
      log,
      "applyCoupon",
      () => ({
        id_user: user.id_user,
        id_checkout: params?.id_checkout,
        hasCode: !!(body && body.code),
      }),
      async () => {
        const { id_checkout } = params || {};
        const { code } = body || {};

        if (!id_checkout) {
          return { error: "id_checkout é obrigatório" };
        }

        if (!code) {
          return { error: "code é obrigatório" };
        }

        const checkout = await CheckoutStorage.getCheckoutById(
          pool,
          id_checkout
        );

        if (!checkout) {
          return { error: "Checkout não encontrado" };
        }

        if (checkout.id_user !== user.id_user) {
          return { error: "Sem permissão" };
        }

        if (checkout.status !== "OPEN") {
          return { error: "Checkout inválido" };
        }

        const checkoutItem = await CheckoutStorage.getCheckoutItemByCheckoutId(
          pool,
          id_checkout
        );

        if (!checkoutItem) {
          return { error: "Item do checkout não encontrado" };
        }

        const coupon = await CheckoutStorage.getCouponByCode(pool, code);

        if (!coupon) {
          return { error: "Cupom inválido" };
        }

        if (!coupon.is_active) {
          return { error: "Cupom inativo" };
        }

        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
          return { error: "Cupom expirado" };
        }

        const subtotal = Number(checkout.subtotal_cents || 0);
        const normalizedScope = String(coupon.scope || "")
          .trim()
          .toUpperCase();

        if (
          coupon.min_order_cents !== null &&
          coupon.min_order_cents !== undefined &&
          subtotal < Number(coupon.min_order_cents)
        ) {
          return { error: "Valor mínimo não atingido" };
        }

        if (
          normalizedScope === "ITEM" &&
          coupon.applies_to_item_id &&
          coupon.applies_to_item_id !== checkoutItem.id_item
        ) {
          return { error: "Cupom não aplicável" };
        }

        if (coupon.max_uses !== null && coupon.max_uses !== undefined) {
          const usageCount = await CheckoutStorage.countCouponUsage(
            pool,
            coupon.id_coupon
          );

          if (Number(usageCount) >= Number(coupon.max_uses)) {
            return { error: "Cupom esgotado" };
          }
        }

        const discount = CheckoutService.calculateDiscount({
          subtotal,
          type: coupon.discount_type,
          value: coupon.value,
          max: coupon.max_discount_cents,
        });

        const total = Math.max(0, subtotal - discount);

        await CheckoutStorage.deactivateCheckoutCoupons(pool, id_checkout);

        await CheckoutStorage.createCheckoutCoupon(pool, {
          id_checkout,
          id_coupon: coupon.id_coupon,
          code_snapshot: coupon.code,
          discount_cents: discount,
        });

        await CheckoutStorage.updateCheckoutTotals(pool, {
          id_checkout,
          subtotal_cents: subtotal,
          discount_cents: discount,
          total_cents: total,
        });

        await CheckoutStorage.updateCheckoutItemDiscount(pool, {
          id_checkout_item: checkoutItem.id_checkout_item,
          discount_cents: discount,
          total_cents: total,
        });

        const summary = await CheckoutStorage.getCheckoutSummary(
          pool,
          id_checkout
        );

        return { checkout: summary };
      }
    );
  }

  static async removeCoupon(user, params) {
    return runWithLogs(
      log,
      "removeCoupon",
      () => ({ id_user: user.id_user, id_checkout: params?.id_checkout }),
      async () => {
        const { id_checkout } = params || {};

        if (!id_checkout) {
          return { error: "id_checkout é obrigatório" };
        }

        const checkout = await CheckoutStorage.getCheckoutById(
          pool,
          id_checkout
        );

        if (!checkout) {
          return { error: "Checkout não encontrado" };
        }

        if (checkout.id_user !== user.id_user) {
          return { error: "Sem permissão" };
        }

        if (checkout.status !== "OPEN") {
          return { error: "Checkout inválido" };
        }

        await CheckoutStorage.deactivateCheckoutCoupons(pool, id_checkout);
        await CheckoutStorage.resetCheckoutItemsDiscount(pool, id_checkout);

        const subtotal = Number(checkout.subtotal_cents || 0);

        await CheckoutStorage.updateCheckoutTotals(pool, {
          id_checkout,
          subtotal_cents: subtotal,
          discount_cents: 0,
          total_cents: subtotal,
        });

        const summary = await CheckoutStorage.getCheckoutSummary(
          pool,
          id_checkout
        );

        return { checkout: summary };
      }
    );
  }

  static async confirmCheckout(user, params, body) {
    return runWithLogs(
      log,
      "confirmCheckout",
      () => ({
        id_user: user.id_user,
        id_checkout: params?.id_checkout,
      }),
      async () => {
        const { id_checkout } = params || {};
        const { id_profile: rawBodyProfile } = body || {};

        if (!id_checkout) {
          return { error: "id_checkout é obrigatório" };
        }

        const checkout = await CheckoutStorage.getCheckoutById(
          pool,
          id_checkout
        );

        if (!checkout) {
          return { error: "Checkout não encontrado" };
        }

        if (checkout.id_user !== user.id_user) {
          return {
            error: "Você não tem permissão para confirmar este checkout",
          };
        }

        if (checkout.status !== "OPEN") {
          return { error: "Checkout não está disponível para confirmação" };
        }

        const fromBody = await CheckoutService.resolveOptionalProfileId(
          pool,
          rawBodyProfile
        );
        if (fromBody.error) {
          return { error: fromBody.error };
        }

        const id_profile =
          fromBody.id_profile || checkout.id_profile || null;

        const checkoutItem = await CheckoutStorage.getCheckoutItemByCheckoutId(
          pool,
          id_checkout
        );

        if (!checkoutItem) {
          return { error: "Item do checkout não encontrado" };
        }

        const subtotal = Number(checkout.subtotal_cents || 0);
        let discount = 0;
        let coupon = await CheckoutStorage.getCheckoutCouponByCheckoutId(
          pool,
          id_checkout
        );

        if (coupon) {
          const normalizedScope = String(coupon.scope || "")
            .trim()
            .toUpperCase();

          if (!coupon.coupon_is_active) {
            return { error: "Cupom vinculado está inativo" };
          }

          if (
            coupon.coupon_expires_at &&
            new Date(coupon.coupon_expires_at) < new Date()
          ) {
            return { error: "Cupom vinculado expirou" };
          }

          if (
            coupon.min_order_cents !== null &&
            coupon.min_order_cents !== undefined &&
            subtotal < Number(coupon.min_order_cents)
          ) {
            return { error: "Cupom não atende mais o pedido mínimo" };
          }

          if (
            normalizedScope === "ITEM" &&
            coupon.applies_to_item_id &&
            coupon.applies_to_item_id !== checkoutItem.id_item
          ) {
            return { error: "Cupom não é mais aplicável a este item" };
          }

          if (coupon.max_uses !== null && coupon.max_uses !== undefined) {
            const usageCount = await CheckoutStorage.countCouponUsage(
              pool,
              coupon.id_coupon
            );

            if (Number(usageCount) >= Number(coupon.max_uses)) {
              return { error: "Cupom esgotado" };
            }
          }

          discount = CheckoutService.calculateDiscount({
            subtotal,
            type: coupon.discount_type,
            value: coupon.value,
            max: coupon.max_discount_cents,
          });
        }

        const total = Math.max(0, subtotal - discount);

        await CheckoutStorage.updateCheckoutTotals(pool, {
          id_checkout,
          subtotal_cents: subtotal,
          discount_cents: discount,
          total_cents: total,
        });

        await CheckoutStorage.updateCheckoutItemDiscount(pool, {
          id_checkout_item: checkoutItem.id_checkout_item,
          discount_cents: discount,
          total_cents: total,
        });

        if (coupon) {
          await CheckoutStorage.deactivateCheckoutCoupons(pool, id_checkout);

          await CheckoutStorage.createCheckoutCoupon(pool, {
            id_checkout,
            id_coupon: coupon.id_coupon,
            code_snapshot: coupon.code_snapshot || coupon.code,
            discount_cents: discount,
          });

          coupon = await CheckoutStorage.getCheckoutCouponByCheckoutId(
            pool,
            id_checkout
          );
        }

        const result = await CheckoutStorage.confirmCheckout(pool, {
          checkout: {
            ...checkout,
            subtotal_cents: subtotal,
            total_cents: total,
          },
          checkout_item: {
            ...checkoutItem,
            discount_cents: discount,
            total_cents: total,
          },
          coupon,
          subtotal_cents: subtotal,
          total_cents: total,
          payment_provider: null,
          id_profile,
        });

        return {
          message: "Order criada com sucesso",
          order: result.order,
          order_item: result.order_item,
          order_coupon: result.order_coupon,
          checkout: result.checkout,
          payment: null,
        };
      }
    );
  }

  static async cancelCheckout(user, params) {
    return runWithLogs(
      log,
      "cancelCheckout",
      () => ({ id_user: user.id_user, id_checkout: params?.id_checkout }),
      async () => {
        const { id_checkout } = params || {};

        if (!id_checkout) {
          return { error: "id_checkout é obrigatório" };
        }

        const checkout = await CheckoutStorage.getCheckoutById(
          pool,
          id_checkout
        );

        if (!checkout) {
          return { error: "Checkout não encontrado" };
        }

        if (checkout.id_user !== user.id_user) {
          return { error: "Você não tem permissão para cancelar este checkout" };
        }

        if (checkout.status !== "OPEN") {
          return { error: "Somente checkouts abertos podem ser cancelados" };
        }

        const updatedCheckout = await CheckoutStorage.cancelCheckout(
          pool,
          id_checkout
        );

        return { checkout: updatedCheckout };
      }
    );
  }

  static calculateDiscount({ subtotal, type, value, max }) {
    const normalizedType = String(type || "")
      .trim()
      .toUpperCase();

    const subtotalNumber = Number(subtotal || 0);
    const valueNumber = Number(value || 0);
    const maxNumber = max !== null && max !== undefined ? Number(max) : null;

    let discount = 0;

    if (normalizedType === "PERCENT") {
      discount = Math.floor((subtotalNumber * valueNumber) / 100);
    }

    if (normalizedType === "FIXED") {
      discount = valueNumber;
    }

    if (maxNumber !== null && discount > maxNumber) {
      discount = maxNumber;
    }

    if (discount > subtotalNumber) {
      discount = subtotalNumber;
    }

    if (discount < 0) {
      discount = 0;
    }

    return discount;
  }
}

module.exports = CheckoutService;
