const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateRuleResolver = require("./AffiliateRuleResolver");
const { createLogger } = require("../utils/logger");

const log = createLogger("AffiliateConversionService");

/**
 * Cria uma conversão (status=PENDING) quando um pedido é confirmado com um
 * cupom cujo dono é afiliado ativo. Silencioso em falhas não-críticas — o
 * checkout nunca deve quebrar por conta do afiliado.
 *
 * Deve ser chamada DENTRO da transação do confirmCheckout, usando `client`.
 */
async function createFromOrder(client, { order, order_coupon, coupon }) {
  try {
    if (!order_coupon || !coupon?.owner_user_id) return null;

    // Auto-afiliação: dono do cupom não pode ser o comprador.
    if (coupon.owner_user_id === order.id_user) {
      log.info("affiliate.conversion.skip.self_purchase", {
        id_order: order.id_order,
        id_coupon: coupon.id_coupon,
      });
      return null;
    }

    const affiliate = await AffiliateStorage.getAffiliateByUserId(
      client,
      coupon.owner_user_id
    );
    if (!affiliate || affiliate.status !== "ACTIVE") return null;

    const rule = await AffiliateRuleResolver.resolve(client, {
      id_coupon: coupon.id_coupon,
      at: order.created_at || null,
    });
    if (!rule) {
      log.warn("affiliate.conversion.skip.no_settings", {
        id_order: order.id_order,
      });
      return null;
    }

    const order_total_cents = Number(order.total_cents || 0);
    const discount_cents = Number(order_coupon.discount_cents || 0);

    const calc = AffiliateRuleResolver.calculate({
      order_total_cents,
      discount_cents,
      rule,
    });
    if (!calc) {
      log.info("affiliate.conversion.skip.min_order", {
        id_order: order.id_order,
        order_total_cents,
        min_order_cents: rule.min_order_cents,
      });
      return null;
    }

    const conversion = await AffiliateStorage.createConversion(client, {
      id_affiliate: affiliate.id_affiliate,
      id_order: order.id_order,
      id_order_coupon: order_coupon.id_order_coupon,
      id_coupon: coupon.id_coupon,
      status: "PENDING",
      order_total_cents,
      discount_cents,
      commission_base_cents: calc.base_cents,
      commission_percent: rule.commission_percent,
      commission_cents: calc.commission_cents,
      rule_snapshot: rule.snapshot,
    });

    log.info("affiliate.conversion.created", {
      id_conversion: conversion?.id_conversion,
      id_order: order.id_order,
      commission_cents: calc.commission_cents,
    });

    return conversion;
  } catch (error) {
    // Nunca derruba o checkout. A auditoria fica no log.
    log.error("affiliate.conversion.create.fail", error);
    return null;
  }
}

/**
 * Reage a uma mudança de status do pedido propagada pelo webhook MP.
 * - PAID      → APPROVED (eligible_at = paid_at + approval_delay_days)
 * - CANCELED  → REVERSED, exceto se já PAID (nesse caso marca disputed)
 *
 * Idempotente por (source, source_event_id).
 */
async function onOrderStatusChange(
  conn,
  { order, newStatus, source, source_event_id, payload = null }
) {
  try {
    const conversion = await AffiliateStorage.getConversionByOrderId(
      conn,
      order.id_order
    );
    if (!conversion) return null;

    // Idempotência — registra o evento antes de agir.
    const eventRow = await AffiliateStorage.recordConversionEvent(conn, {
      id_conversion: conversion.id_conversion,
      source,
      source_event_id,
      from_status: conversion.status,
      to_status: newStatus,
      payload,
    });
    if (!eventRow) {
      // Evento duplicado — nada a fazer.
      return conversion;
    }

    if (newStatus === "PAID" && conversion.status === "PENDING") {
      const delay = conversion.rule_snapshot?.approval_delay_days ?? 0;
      const paid_at = new Date();
      const eligible_at = new Date(paid_at.getTime() + delay * 86400000);

      return await AffiliateStorage.updateConversionStatus(conn, {
        id_conversion: conversion.id_conversion,
        status: "APPROVED",
        approved_at: paid_at,
        eligible_at,
      });
    }

    if (newStatus === "CANCELED") {
      if (conversion.status === "PAID") {
        // Conversão já paga — não reverte automaticamente. Marca disputa.
        return await AffiliateStorage.updateConversionStatus(conn, {
          id_conversion: conversion.id_conversion,
          status: conversion.status,
          disputed: true,
          reversal_reason: `Order canceled after payout (${source_event_id})`,
        });
      }
      if (conversion.status !== "REVERSED") {
        return await AffiliateStorage.updateConversionStatus(conn, {
          id_conversion: conversion.id_conversion,
          status: "REVERSED",
          reversed_at: new Date(),
          reversal_reason: `Order canceled (${source_event_id})`,
        });
      }
    }

    return conversion;
  } catch (error) {
    log.error("affiliate.conversion.status_change.fail", error);
    return null;
  }
}

module.exports = { createFromOrder, onOrderStatusChange };
