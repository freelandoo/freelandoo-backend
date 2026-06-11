const pool = require("../databases");
const StripeService = require("./StripeService");
const ProfileSubscriptionStorage = require("../storages/ProfileSubscriptionStorage");
const StripeWebhookEventStorage = require("../storages/StripeWebhookEventStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateConversionService = require("./AffiliateConversionService");
const BookingService = require("./BookingService");
const ClanService = require("./ClanService");
const ManifestationService = require("./ManifestationService");
const PolenProductService = require("./PolenProductService");
const PremiumService = require("./PremiumService");
const ProfileProductOrderService = require("./ProfileProductOrderService");
const CasaParticipantService = require("./CasaParticipantService");
const XpStorage = require("../storages/XpStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("StripeWebhookService");

async function getStatusIdByDesc(conn, desc) {
  const { rows } = await conn.query(
    `SELECT id_status FROM public.tb_status WHERE desc_status = $1 LIMIT 1`,
    [desc]
  );
  return rows[0]?.id_status || null;
}

function toTimestamp(epoch) {
  if (!epoch) return null;
  return new Date(Number(epoch) * 1000);
}

async function applyProfileActivation(conn, { id_profile, id_user }) {
  if (!id_profile) return;
  const taxaPendenteId = await getStatusIdByDesc(conn, "taxa_pendente");
  const feePaidId = await getStatusIdByDesc(conn, "fee_paid");
  if (taxaPendenteId) {
    await ProfileStorage.deleteProfileStatus(conn, {
      id_profile,
      id_status: taxaPendenteId,
    });
  }
  if (feePaidId) {
    await ProfileStorage.insertProfileStatus(conn, {
      id_profile,
      id_status: feePaidId,
      created_by: id_user,
    });
  }

  // Registra afiliado automaticamente se ainda não existir
  const existing = await AffiliateStorage.getAffiliateByUserId(conn, id_user);
  if (!existing) {
    await AffiliateStorage.upsertAffiliate(conn, {
      id_user,
      status: "ACTIVE",
      created_by: id_user,
    });
    log.info("affiliate.auto_registered", { id_user });
  }
}

async function revertProfileActivation(conn, { id_profile, id_user }) {
  if (!id_profile) return;
  const taxaPendenteId = await getStatusIdByDesc(conn, "taxa_pendente");
  const feePaidId = await getStatusIdByDesc(conn, "fee_paid");
  if (feePaidId) {
    await ProfileStorage.deleteProfileStatus(conn, {
      id_profile,
      id_status: feePaidId,
    });
  }
  if (taxaPendenteId) {
    await ProfileStorage.insertProfileStatus(conn, {
      id_profile,
      id_status: taxaPendenteId,
      created_by: id_user,
    });
  }
}

async function handleCheckoutCompleted(conn, session) {
  const row = await ProfileSubscriptionStorage.findBySessionId(conn, session.id);
  if (!row) {
    log.warn("checkout.completed.row_missing", { session_id: session.id });
    return;
  }

  const isOneTime = session.mode === "payment";

  const subscriptionId = !isOneTime && (
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null
  );

  const paymentIntentId = isOneTime && (
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null
  );

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  // Ativação one-time: charge via PI; vitalício (current_period_end=NULL).
  // Subscription legacy: charge via invoice/subscription; período recorrente.
  let chargeId = null;
  let periodStart = null;
  let periodEnd = null;

  if (isOneTime && paymentIntentId) {
    try {
      const pi = await StripeService.retrievePaymentIntent(paymentIntentId, {
        expand: ["latest_charge"],
      });
      chargeId = typeof pi.latest_charge === "object"
        ? pi.latest_charge?.id
        : pi.latest_charge || null;
    } catch (err) {
      log.warn("checkout.completed.pi_lookup_fail", { paymentIntentId, message: err.message });
    }
    periodStart = new Date();
    periodEnd = null; // vitalício
  } else if (subscriptionId) {
    try {
      const subscription = await StripeService.retrieveSubscription(subscriptionId);
      periodStart = toTimestamp(subscription?.current_period_start);
      periodEnd = toTimestamp(subscription?.current_period_end);
    } catch (err) {
      log.warn("checkout.completed.sub_lookup_fail", { subscriptionId, message: err.message });
    }
  }

  const updatedSubscription = await ProfileSubscriptionStorage.updateBySessionId(
    conn,
    session.id,
    {
      status: "active",
      stripe_subscription_id: subscriptionId || null,
      stripe_payment_intent_id: paymentIntentId || null,
      stripe_charge_id: chargeId || null,
      stripe_customer_id: customerId,
      paid_at: new Date(),
      current_period_start: periodStart,
      current_period_end: periodEnd,
      raw_event: session,
    }
  );

  await applyProfileActivation(conn, {
    id_profile: row.id_profile,
    id_user: row.id_user,
  });

  // XP por ativação paga — source_id = checkout session para idempotência
  XpStorage.award(pool, {
    id_profile: row.id_profile,
    event_type: "profile_activated",
    source_type: "stripe_checkout",
    source_id: session.id,
  }).catch(() => {});

  await AffiliateConversionService.createFromProfileSubscription(conn, {
    subscription: updatedSubscription || row,
    session,
  });
}

async function handleInvoicePaid(conn, invoice) {
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id || null;
  if (!subscriptionId) return;

  const row = await ProfileSubscriptionStorage.findBySubscriptionId(
    conn,
    subscriptionId
  );
  if (!row) {
    log.warn("invoice.paid.row_missing", { subscriptionId });
    return;
  }

  const subscription = await StripeService.retrieveSubscription(subscriptionId);

  await ProfileSubscriptionStorage.updateBySubscriptionId(conn, subscriptionId, {
    status: "active",
    paid_at: new Date(),
    current_period_start: toTimestamp(subscription.current_period_start),
    current_period_end: toTimestamp(subscription.current_period_end),
    raw_event: invoice,
  });

  await applyProfileActivation(conn, {
    id_profile: row.id_profile,
    id_user: row.id_user,
  });

  // XP por renovação anual — apenas subscription_cycle, não a primeira cobrança
  if (invoice.billing_reason === "subscription_cycle") {
    XpStorage.award(pool, {
      id_profile: row.id_profile,
      event_type: "profile_renewed",
      source_type: "stripe_invoice",
      source_id: invoice.id,
    }).catch(() => {});
  }
}

async function handleInvoiceFailed(conn, invoice) {
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id || null;
  if (!subscriptionId) return;

  await ProfileSubscriptionStorage.updateBySubscriptionId(conn, subscriptionId, {
    status: "past_due",
    raw_event: invoice,
  });
}

/**
 * Reembolso de cobrança Stripe (charge.refunded). Reverte a comissão do afiliado
 * quando o estorno acontece dentro da janela de holdback (ou ainda não pago).
 * Se já foi pago, a lógica em onOrderStatusChange marca como disputed.
 */
async function handleChargeRefunded(conn, charge) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id || null;

  let profileSubscription =
    (await ProfileSubscriptionStorage.findByChargeId(conn, charge.id)) ||
    (paymentIntentId
      ? await ProfileSubscriptionStorage.findByPaymentIntentId(conn, paymentIntentId)
      : null);

  if (!profileSubscription && charge.invoice) {
    const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id;
    try {
      const invoice = await StripeService.retrieveInvoice?.(invoiceId);
      const subscriptionId =
        typeof invoice?.subscription === "string"
          ? invoice.subscription
          : invoice?.subscription?.id || null;
      if (subscriptionId) {
        profileSubscription = await ProfileSubscriptionStorage.findBySubscriptionId(
          conn,
          subscriptionId
        );
      }
    } catch (err) {
      log.warn("charge.refunded.profile_invoice_lookup_fail", { invoiceId, error: err.message });
    }
  }

  if (profileSubscription) {
    await conn.query(
      `UPDATE public.tb_profile_subscription
       SET status = 'expired',
           refunded_at = COALESCE(refunded_at, NOW()),
           canceled_at = COALESCE(canceled_at, NOW()),
           stripe_charge_id = COALESCE(stripe_charge_id, $2),
           raw_event = $3,
           updated_at = NOW()
       WHERE id_subscription = $1`,
      [profileSubscription.id_subscription, charge.id, charge]
    );

    await revertProfileActivation(conn, {
      id_profile: profileSubscription.id_profile,
      id_user: profileSubscription.id_user,
    });

    if (profileSubscription.stripe_checkout_session_id) {
      const bySession = await conn.query(
        `SELECT * FROM tb_order WHERE payment_provider = 'stripe' AND payment_provider_ref = $1 LIMIT 1`,
        [profileSubscription.stripe_checkout_session_id]
      );
      const subscriptionOrder = bySession.rows[0] || null;
      if (subscriptionOrder) {
        await AffiliateConversionService.onOrderStatusChange(conn, {
          order: subscriptionOrder,
          newStatus: "CANCELED",
          source: "stripe_webhook",
          source_event_id: `charge.refunded:${charge.id}`,
          payload: { charge_id: charge.id, amount_refunded: charge.amount_refunded },
        });
      }
    }

    return;
  }

  // Tenta achar a order pela invoice → subscription → session, ou por payment_intent direto.
  let order = null;
  if (paymentIntentId) {
    const byPi = await conn.query(
      `SELECT * FROM tb_order WHERE payment_provider = 'stripe' AND payment_provider_ref = $1 LIMIT 1`,
      [paymentIntentId]
    );
    order = byPi.rows[0] || null;
  }

  if (!order && charge.invoice) {
    const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id;
    let subscriptionId = null;
    try {
      const invoice = await StripeService.retrieveInvoice?.(invoiceId);
      subscriptionId =
        typeof invoice?.subscription === "string"
          ? invoice.subscription
          : invoice?.subscription?.id || null;
    } catch (err) {
      log.warn("charge.refunded.invoice_lookup_fail", { invoiceId, error: err.message });
    }
    if (subscriptionId) {
      const sub = await ProfileSubscriptionStorage.findBySubscriptionId(conn, subscriptionId);
      if (sub?.stripe_checkout_session_id) {
        const bySession = await conn.query(
          `SELECT * FROM tb_order WHERE payment_provider = 'stripe' AND payment_provider_ref = $1 LIMIT 1`,
          [sub.stripe_checkout_session_id]
        );
        order = bySession.rows[0] || null;
      }
    }
  }

  if (!order) {
    log.warn("charge.refunded.order_not_found", { charge_id: charge.id });
    return;
  }

  await AffiliateConversionService.onOrderStatusChange(conn, {
    order,
    newStatus: "CANCELED",
    source: "stripe_webhook",
    source_event_id: `charge.refunded:${charge.id}`,
    payload: { charge_id: charge.id, amount_refunded: charge.amount_refunded },
  });
}

async function handleSubscriptionDeleted(conn, subscription) {
  const row = await ProfileSubscriptionStorage.findBySubscriptionId(
    conn,
    subscription.id
  );
  if (!row) return;

  await ProfileSubscriptionStorage.updateBySubscriptionId(conn, subscription.id, {
    status: "canceled",
    canceled_at: new Date(),
    raw_event: subscription,
  });

  // Ao cancelar, reverte perfil pro estado taxa_pendente
  const taxaPendenteId = await getStatusIdByDesc(conn, "taxa_pendente");
  const feePaidId = await getStatusIdByDesc(conn, "fee_paid");
  if (row.id_profile) {
    if (feePaidId) {
      await ProfileStorage.deleteProfileStatus(conn, {
        id_profile: row.id_profile,
        id_status: feePaidId,
      });
    }
    if (taxaPendenteId) {
      await ProfileStorage.insertProfileStatus(conn, {
        id_profile: row.id_profile,
        id_status: taxaPendenteId,
        created_by: row.id_user,
      });
    }
  }
}

/**
 * Mapeia metadata.type → identificador semântico para a conversão de afiliado.
 * Retorna null quando o fluxo não deve gerar comissão.
 *
 * Geram comissão: Loja (produto), Cursos e Booking/Serviços (modelo aditivo,
 * opt-in por item, comissão embutida via meta.affiliate_commission_cents) e
 * Conveniência da Casa Views (casa_participant_order, %-base sobre o total).
 * A assinatura usa fluxo próprio (createFromProfileSubscription).
 * NÃO geram comissão: Poléns, Premium (prêmio), Clã e Manifestação.
 */
function resolveCommissionContext(meta) {
  switch (meta?.type) {
    case "profile_product_order":  return { source_context: "loja_produto" };
    case "course_purchase":        return { source_context: "course_purchase" };
    case "booking_deposit":        return { source_context: "booking_deposit" };
    case "casa_participant_order": return { source_context: "casa_conveniencia" };
    default: return null;
  }
}

function resolveBuyerUserId(session, meta) {
  if (meta?.id_buyer_user) return String(meta.id_buyer_user);
  if (meta?.user_id) return String(meta.user_id);
  if (session?.client_reference_id) return String(session.client_reference_id);
  return null;
}

// Clans não geram comissão de afiliado (nem vendedor nem indicador). Resolve o
// perfil-fonte da venda (serviço/booking ou curso) e diz se é clan.
async function saleIsFromClan(conn, meta) {
  try {
    let profileId = null;
    if (meta?.type === "booking_deposit") {
      profileId = meta.profile_id || null;
    } else if (meta?.type === "course_purchase" && meta.course_id) {
      const r = await conn.query(
        `SELECT profile_id FROM public.courses WHERE id = $1 LIMIT 1`,
        [meta.course_id]
      );
      profileId = r.rows[0]?.profile_id || null;
    }
    if (!profileId) return false;
    const pr = await conn.query(
      `SELECT is_clan FROM public.tb_profile WHERE id_profile = $1 LIMIT 1`,
      [profileId]
    );
    return pr.rows[0]?.is_clan === true;
  } catch {
    return false;
  }
}

async function maybeAttributeCouponCommission(conn, session, meta) {
  try {
    if (!meta?.coupon_code) return;
    const ctx = resolveCommissionContext(meta);
    if (!ctx) return;
    // Venda de clan não gera comissão de afiliado.
    if (await saleIsFromClan(conn, meta)) {
      log.info("affiliate.commission.skip_clan", { type: meta.type });
      return;
    }
    const id_user_buyer = resolveBuyerUserId(session, meta);
    const total_cents = Number(session?.amount_total || 0);
    if (!total_cents) return;
    // Aditivo (loja/cursos/serviços/booking): comissão embutida e cravada no
    // checkout via meta.affiliate_commission_cents. Conveniência não manda esse
    // campo → cai no %-base sobre o total.
    const explicitCents = Number(meta.affiliate_commission_cents);
    const explicit_commission_cents = Number.isFinite(explicitCents) && explicitCents > 0
      ? explicitCents
      : null;
    await AffiliateConversionService.createFromGenericPaidOrder(conn, {
      coupon_code: meta.coupon_code,
      id_user_buyer,
      total_cents,
      source_context: ctx.source_context,
      payment_provider: "stripe",
      payment_provider_ref: session.id,
      raw_webhook: session,
      explicit_commission_cents,
    });
  } catch (err) {
    log.error("affiliate.commission.attribute.fail", { error: err.message });
  }
}

/**
 * Entrega (fulfillment) de uma checkout session PAGA. Compartilhado entre
 * checkout.session.completed (métodos síncronos: cartão) e
 * checkout.session.async_payment_succeeded (métodos assíncronos: Pix/boleto).
 * Os confirmadores downstream são idempotentes por session id, então receber
 * os dois eventos para a mesma session não duplica nada.
 */
async function fulfillCheckoutSession(session) {
  const meta = session.metadata || {};
  if (meta.type === "booking_deposit") {
    // Booking deposit payment
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
    await BookingService.confirmBookingFromWebhook(session.id, paymentIntentId);
  } else if (meta.type === "clan_slot") {
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
    await ClanService.confirmSlotPurchaseFromWebhook(
      session.id,
      paymentIntentId
    );
  } else if (meta.type === "manifestation") {
    await ManifestationService.confirmStripeSession(session);
  } else if (meta.type === "polen_purchase") {
    await PolenProductService.confirmStripeSession(session);
  } else if (meta.type === "premium") {
    await PremiumService.confirmStripeSession(session);
  } else if (meta.type === "course_purchase") {
    const CoursesService = require("./CoursesService");
    await CoursesService.confirmStripeSession(session);
  } else if (meta.type === "profile_product_order") {
    await ProfileProductOrderService.confirmStripeSession(session);
  } else if (meta.type === "casa_participant_order") {
    await CasaParticipantService.confirmStripeSession(session);
  } else {
    // Subscription checkout
    await handleCheckoutCompleted(pool, session);
  }
  // Atribuição de comissão para fluxos não-assinatura quando o cupom
  // veio capturado via ?cupom= no link. Idempotente por (provider, ref).
  await maybeAttributeCouponCommission(pool, session, meta);
}

/**
 * Processa um evento Stripe já verificado. Idempotente via tb_stripe_webhook_event.
 */
async function processEvent(event) {
  const inserted = await StripeWebhookEventStorage.recordIfNew(pool, {
    event_id: event.id,
    event_type: event.type,
    payload: event,
  });

  if (!inserted) {
    log.info("duplicate.skip", { event_id: event.id, type: event.type });
    return { duplicate: true };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // Métodos assíncronos (Pix/boleto): o completed chega com payment_status
      // "unpaid" ANTES do dinheiro cair. A entrega acontece só no
      // async_payment_succeeded — sem este guard, ativaríamos perfil/poléns/
      // pedido sem pagamento confirmado.
      if (session.payment_status === "unpaid") {
        log.info("checkout.completed.awaiting_async_payment", {
          session_id: session.id,
          meta_type: session.metadata?.type || null,
        });
        break;
      }
      await fulfillCheckoutSession(session);
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      await fulfillCheckoutSession(event.data.object);
      break;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      // Pagamento assíncrono expirou/falhou (ex.: Pix não pago no prazo).
      // Nenhum estado foi entregue (o completed unpaid foi ignorado acima);
      // a linha pendente segue o mesmo caminho de uma session abandonada.
      log.warn("checkout.async_payment_failed", {
        session_id: session.id,
        meta_type: session.metadata?.type || null,
      });
      break;
    }
    case "invoice.payment_succeeded":
    case "invoice.paid":
      await handleInvoicePaid(pool, event.data.object);
      break;
    case "invoice.payment_failed":
      await handleInvoiceFailed(pool, event.data.object);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(pool, event.data.object);
      break;
    case "charge.refunded": {
      const charge = event.data.object;
      const productOrderResult = await ProfileProductOrderService.handleChargeRefunded(charge);
      if (productOrderResult && !productOrderResult.ignored) break;
      const casaResult = await CasaParticipantService.handleChargeRefunded(charge);
      if (casaResult && !casaResult.ignored) break;
      const BookingPayoutService = require("./BookingPayoutService");
      const bookingResult = await BookingPayoutService.handleChargeRefunded(charge);
      if (bookingResult && !bookingResult.ignored) break;
      const polenResult = await PolenProductService.handleChargeRefunded(charge);
      if (polenResult && !polenResult.ignored) break;
      const premiumResult = await PremiumService.handleChargeRefunded(charge);
      if (premiumResult && !premiumResult.ignored) break;
      const CoursesService = require("./CoursesService");
      const courseResult = await CoursesService.handleChargeRefunded(charge);
      if (courseResult && !courseResult.ignored) break;
      await handleChargeRefunded(pool, charge);
      break;
    }
    default:
      log.debug("unhandled.event", { type: event.type });
  }

  return { ok: true };
}

module.exports = { processEvent };
