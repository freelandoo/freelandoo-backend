const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateRuleResolver = require("./AffiliateRuleResolver");
const XpStorage = require("../storages/XpStorage");
const pool = require("../databases");
const { createLogger } = require("../utils/logger");

const log = createLogger("AffiliateConversionService");

function toCents(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function getSessionAmounts(session, subscription) {
  const fallbackSubtotal = toCents(subscription?.amount_cents, 0);
  const discount_cents = toCents(session?.total_details?.amount_discount, 0);
  const totalFallback = Math.max(0, fallbackSubtotal - discount_cents);
  const total_cents = toCents(session?.amount_total, totalFallback);
  const subtotal_cents = Math.max(
    toCents(session?.amount_subtotal, fallbackSubtotal),
    total_cents + discount_cents
  );

  return { subtotal_cents, total_cents, discount_cents };
}

async function getOrderCoupon(conn, { id_order, id_coupon }) {
  const { rows } = await conn.query(
    `
    SELECT *
    FROM tb_order_coupon
    WHERE id_order = $1
      AND id_coupon = $2
    LIMIT 1
    `,
    [id_order, id_coupon]
  );
  return rows[0] || null;
}

async function ensureStripeSubscriptionOrder(conn, {
  subscription,
  session,
  coupon,
  subtotal_cents,
  total_cents,
  discount_cents,
}) {
  const sessionId =
    session?.id || subscription?.stripe_checkout_session_id || null;
  const paid_at = new Date();
  const currency = String(
    session?.currency || subscription?.currency || "BRL"
  ).toUpperCase();

  if (sessionId) {
    const existing = await conn.query(
      `
      SELECT *
      FROM tb_order
      WHERE payment_provider = 'stripe'
        AND payment_provider_ref = $1
      LIMIT 1
      `,
      [sessionId]
    );
    const order = existing.rows[0] || null;
    if (order) {
      let order_coupon = await getOrderCoupon(conn, {
        id_order: order.id_order,
        id_coupon: coupon.id_coupon,
      });
      if (!order_coupon) {
        const createdCoupon = await conn.query(
          `
          INSERT INTO tb_order_coupon (
            id_coupon,
            id_order,
            code_snapshot,
            discount_cents,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $5)
          RETURNING *
          `,
          [
            coupon.id_coupon,
            order.id_order,
            coupon.code,
            discount_cents,
            subscription.id_user,
          ]
        );
        order_coupon = createdCoupon.rows[0];
      }
      return { order, order_coupon };
    }
  }

  const insertedOrder = await conn.query(
    `
    INSERT INTO tb_order (
      id_user,
      id_profile,
      status,
      subtotal_cents,
      total_cents,
      currency,
      payment_provider,
      payment_provider_ref,
      approved_at,
      paid_at,
      raw_webhook
    )
    VALUES ($1, $2, 'PAID', $3, $4, $5, 'stripe', $6, $7, $7, $8)
    RETURNING *
    `,
    [
      subscription.id_user,
      subscription.id_profile || null,
      subtotal_cents,
      total_cents,
      currency,
      sessionId,
      paid_at,
      session || null,
    ]
  );
  const order = insertedOrder.rows[0];

  const insertedCoupon = await conn.query(
    `
    INSERT INTO tb_order_coupon (
      id_coupon,
      id_order,
      code_snapshot,
      discount_cents,
      created_by,
      updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $5)
    RETURNING *
    `,
    [
      coupon.id_coupon,
      order.id_order,
      coupon.code,
      discount_cents,
      subscription.id_user,
    ]
  );

  return { order, order_coupon: insertedCoupon.rows[0] };
}

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
 * Stripe subscription checkout does not pass through the legacy checkout table,
 * so we create a paid internal order + order coupon and then reuse the affiliate
 * conversion model that the dashboard already reads.
 */
async function createFromProfileSubscription(client, { subscription, session }) {
  try {
    if (!subscription?.id_coupon) return null;

    const couponRes = await client.query(
      `
      SELECT id_coupon, code, owner_user_id
      FROM tb_coupon
      WHERE id_coupon = $1
      LIMIT 1
      `,
      [subscription.id_coupon]
    );
    const coupon = couponRes.rows[0] || null;
    if (!coupon?.owner_user_id) return null;

    if (String(coupon.owner_user_id) === String(subscription.id_user)) {
      log.info("affiliate.conversion.skip.self_purchase", {
        id_subscription: subscription.id_subscription,
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
      at: subscription.paid_at || subscription.created_at || null,
    });
    if (!rule) {
      log.warn("affiliate.conversion.skip.no_settings", {
        id_subscription: subscription.id_subscription,
      });
      return null;
    }

    const { subtotal_cents, total_cents, discount_cents } = getSessionAmounts(
      session,
      subscription
    );

    const calc = AffiliateRuleResolver.calculate({
      order_total_cents: subtotal_cents,
      discount_cents,
      rule,
    });
    if (!calc) {
      log.info("affiliate.conversion.skip.min_order", {
        id_subscription: subscription.id_subscription,
        subtotal_cents,
        min_order_cents: rule.min_order_cents,
      });
      return null;
    }

    const { order, order_coupon } = await ensureStripeSubscriptionOrder(client, {
      subscription,
      session,
      coupon,
      subtotal_cents,
      total_cents,
      discount_cents,
    });

    const existing = await AffiliateStorage.getConversionByOrderId(
      client,
      order.id_order
    );
    if (existing) return existing;

    const conversion = await AffiliateStorage.createConversion(client, {
      id_affiliate: affiliate.id_affiliate,
      id_order: order.id_order,
      id_order_coupon: order_coupon.id_order_coupon,
      id_coupon: coupon.id_coupon,
      status: "PENDING",
      order_total_cents: subtotal_cents,
      discount_cents,
      commission_base_cents: calc.base_cents,
      commission_percent: rule.commission_percent,
      commission_cents: calc.commission_cents,
      rule_snapshot: {
        ...rule.snapshot,
        source_context: "stripe_subscription",
        id_subscription: subscription.id_subscription || null,
        stripe_checkout_session_id:
          session?.id || subscription.stripe_checkout_session_id || null,
        stripe_subscription_id:
          typeof session?.subscription === "string"
            ? session.subscription
            : session?.subscription?.id ||
              subscription.stripe_subscription_id ||
              null,
        amount_subtotal_cents: subtotal_cents,
        amount_total_cents: total_cents,
      },
    });

    if (!conversion) {
      return AffiliateStorage.getConversionByOrderId(client, order.id_order);
    }

    const approved = await onOrderStatusChange(client, {
      order,
      newStatus: "PAID",
      source: "stripe_webhook",
      source_event_id: `checkout.session.completed:${session?.id || order.id_order}`,
      payload: {
        id_subscription: subscription.id_subscription || null,
        stripe_checkout_session_id:
          session?.id || subscription.stripe_checkout_session_id || null,
      },
    });

    log.info("affiliate.conversion.created_from_subscription", {
      id_conversion: approved?.id_conversion || conversion.id_conversion,
      id_subscription: subscription.id_subscription,
      id_order: order.id_order,
      commission_cents: calc.commission_cents,
    });

    return approved || conversion;
  } catch (error) {
    log.error("affiliate.conversion.subscription.fail", error);
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
      const holdback = conversion.rule_snapshot?.holdback_days ?? 8;
      const paid_at = new Date();
      const eligible_at = new Date(paid_at.getTime() + delay * 86400000);
      const holdback_until = new Date(paid_at.getTime() + holdback * 86400000);

      const updated = await AffiliateStorage.updateConversionStatus(conn, {
        id_conversion: conversion.id_conversion,
        status: "APPROVED",
        approved_at: paid_at,
        eligible_at,
        holdback_until,
      });

      // XP para todos os perfis ativos do afiliado (fire-and-forget, fora da transação)
      try {
        const affiliate = await AffiliateStorage.getAffiliateById(conn, conversion.id_affiliate);
        if (affiliate?.id_user) {
          const profileIds = await XpStorage.getUserActiveProfileIds(pool, affiliate.id_user);
          for (const id_profile of profileIds) {
            await XpStorage.award(pool, {
              id_profile,
              event_type: "affiliate_sale_confirmed",
              source_type: "conversion",
              source_id: conversion.id_conversion,
            });
          }
        }
      } catch (xpErr) {
        log.error("affiliate.xp.award.fail", { error: xpErr.message });
      }

      return updated;
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

/**
 * Cria conversão para fluxos NÃO-assinatura (loja, polens, cursos, booking).
 *
 * Não há desconto — o cupom só registra atribuição de comissão para o
 * afiliado dono. Idempotente por (payment_provider, payment_provider_ref).
 *
 * Uso típico: chamar do webhook do Stripe (ou hook equivalente) DEPOIS de
 * o pagamento já ter sido confirmado no fluxo nativo do service.
 *
 * @param {Object} client - pool ou conexão da transação chamadora
 * @param {Object} params
 * @param {string} params.coupon_code - cupom capturado via ?cupom= (uppercase)
 * @param {string} params.id_user_buyer - usuário que pagou
 * @param {string|null} params.id_profile - perfil envolvido (opcional)
 * @param {number} params.total_cents - valor pago (em centavos)
 * @param {string} params.source_context - "loja_produto" | "polen_pack" | "course_purchase" | "booking"
 * @param {string} params.payment_provider - "stripe" (default)
 * @param {string} params.payment_provider_ref - ID externo único (Stripe session/payment intent) — para idempotência
 * @param {Object|null} params.raw_webhook - payload do webhook, opcional
 * @param {Date|null} params.paid_at - data do pagamento, default NOW
 * @returns {Promise<Object|null>} - conversão criada/aprovada ou null se skip
 */
async function createFromGenericPaidOrder(client, {
  coupon_code,
  id_user_buyer,
  id_profile = null,
  total_cents,
  source_context,
  payment_provider = "stripe",
  payment_provider_ref,
  raw_webhook = null,
  paid_at = null,
}) {
  try {
    if (!coupon_code || !id_user_buyer || !payment_provider_ref) return null;
    if (!Number.isFinite(Number(total_cents)) || Number(total_cents) <= 0) return null;

    const code = String(coupon_code).trim().toUpperCase();
    if (!code) return null;

    const couponRes = await client.query(
      `SELECT id_coupon, code, owner_user_id, is_active, expires_at
         FROM tb_coupon
        WHERE code = $1
        LIMIT 1`,
      [code]
    );
    const coupon = couponRes.rows[0] || null;
    if (!coupon) return null;
    if (!coupon.owner_user_id) return null; // manual sem owner não gera comissão
    if (!coupon.is_active) return null;
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return null;
    if (String(coupon.owner_user_id) === String(id_user_buyer)) {
      log.info("affiliate.conversion.skip.self_purchase", {
        source_context, id_coupon: coupon.id_coupon,
      });
      return null;
    }

    const affiliate = await AffiliateStorage.getAffiliateByUserId(client, coupon.owner_user_id);
    if (!affiliate || affiliate.status !== "ACTIVE") return null;

    const when = paid_at instanceof Date ? paid_at : new Date();

    const rule = await AffiliateRuleResolver.resolve(client, {
      id_coupon: coupon.id_coupon,
      at: when.toISOString(),
    });
    if (!rule) {
      log.warn("affiliate.conversion.skip.no_settings", { source_context, code });
      return null;
    }

    const subtotal_cents = toCents(total_cents, 0);
    const calc = AffiliateRuleResolver.calculate({
      order_total_cents: subtotal_cents,
      discount_cents: 0,
      rule,
    });
    if (!calc) {
      log.info("affiliate.conversion.skip.min_order", {
        source_context, subtotal_cents, min_order_cents: rule.min_order_cents,
      });
      return null;
    }

    // Idempotência: se já existe order com (provider, ref), reusa.
    const existingOrderRes = await client.query(
      `SELECT * FROM tb_order
        WHERE payment_provider = $1 AND payment_provider_ref = $2
        LIMIT 1`,
      [payment_provider, payment_provider_ref]
    );
    let order = existingOrderRes.rows[0] || null;
    let order_coupon = null;

    if (order) {
      const existingCouponRes = await client.query(
        `SELECT * FROM tb_order_coupon
          WHERE id_order = $1 AND id_coupon = $2 LIMIT 1`,
        [order.id_order, coupon.id_coupon]
      );
      order_coupon = existingCouponRes.rows[0] || null;
      if (!order_coupon) {
        const createdCoupon = await client.query(
          `INSERT INTO tb_order_coupon (
             id_coupon, id_order, code_snapshot, discount_cents, created_by, updated_by
           ) VALUES ($1, $2, $3, 0, $4, $4)
           RETURNING *`,
          [coupon.id_coupon, order.id_order, coupon.code, id_user_buyer]
        );
        order_coupon = createdCoupon.rows[0];
      }
    } else {
      const insertedOrder = await client.query(
        `INSERT INTO tb_order (
           id_user, id_profile, status, subtotal_cents, total_cents, currency,
           payment_provider, payment_provider_ref, approved_at, paid_at, raw_webhook
         ) VALUES ($1, $2, 'PAID', $3, $3, 'BRL', $4, $5, $6, $6, $7)
         RETURNING *`,
        [id_user_buyer, id_profile, subtotal_cents, payment_provider, payment_provider_ref, when, raw_webhook]
      );
      order = insertedOrder.rows[0];

      const insertedCoupon = await client.query(
        `INSERT INTO tb_order_coupon (
           id_coupon, id_order, code_snapshot, discount_cents, created_by, updated_by
         ) VALUES ($1, $2, $3, 0, $4, $4)
         RETURNING *`,
        [coupon.id_coupon, order.id_order, coupon.code, id_user_buyer]
      );
      order_coupon = insertedCoupon.rows[0];
    }

    const existing = await AffiliateStorage.getConversionByOrderId(client, order.id_order);
    if (existing) return existing;

    const conversion = await AffiliateStorage.createConversion(client, {
      id_affiliate: affiliate.id_affiliate,
      id_order: order.id_order,
      id_order_coupon: order_coupon.id_order_coupon,
      id_coupon: coupon.id_coupon,
      status: "PENDING",
      order_total_cents: subtotal_cents,
      discount_cents: 0,
      commission_base_cents: calc.base_cents,
      commission_percent: rule.commission_percent,
      commission_cents: calc.commission_cents,
      rule_snapshot: {
        ...rule.snapshot,
        source_context,
        payment_provider,
        payment_provider_ref,
      },
    });

    if (!conversion) {
      return AffiliateStorage.getConversionByOrderId(client, order.id_order);
    }

    const approved = await onOrderStatusChange(client, {
      order,
      newStatus: "PAID",
      source: payment_provider,
      source_event_id: `${source_context}:${payment_provider_ref}`,
      payload: { source_context, payment_provider_ref },
    });

    log.info("affiliate.conversion.created_from_generic", {
      source_context,
      id_conversion: approved?.id_conversion || conversion.id_conversion,
      id_order: order.id_order,
      commission_cents: calc.commission_cents,
    });

    return approved || conversion;
  } catch (error) {
    log.error("affiliate.conversion.generic.fail", { error: error.message, source_context });
    return null;
  }
}

module.exports = {
  createFromOrder,
  createFromProfileSubscription,
  createFromGenericPaidOrder,
  onOrderStatusChange,
};
