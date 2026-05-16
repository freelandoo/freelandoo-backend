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

async function handleCheckoutCompleted(conn, session) {
  const row = await ProfileSubscriptionStorage.findBySessionId(conn, session.id);
  if (!row) {
    log.warn("checkout.completed.row_missing", { session_id: session.id });
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  const subscription = subscriptionId
    ? await StripeService.retrieveSubscription(subscriptionId)
    : null;

  const updatedSubscription = await ProfileSubscriptionStorage.updateBySessionId(
    conn,
    session.id,
    {
      status: "active",
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      paid_at: new Date(),
      current_period_start: toTimestamp(subscription?.current_period_start),
      current_period_end: toTimestamp(subscription?.current_period_end),
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
      } else {
        // Subscription checkout
        await handleCheckoutCompleted(pool, session);
      }
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
    case "charge.refunded":
      await handleChargeRefunded(pool, event.data.object);
      break;
    default:
      log.debug("unhandled.event", { type: event.type });
  }

  return { ok: true };
}

module.exports = { processEvent };
