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
const CommunitySlotService = require("./CommunitySlotService");
const CommunityMembershipService = require("./CommunityMembershipService");
const XpBoostService = require("./XpBoostService");
const XpBoostStorage = require("../storages/XpBoostStorage");
const CommunityStorage = require("../storages/CommunityStorage");
const XpStorage = require("../storages/XpStorage");
const BookingStorage = require("../storages/BookingStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const PolenProductStorage = require("../storages/PolenProductStorage");
const PremiumStorage = require("../storages/PremiumStorage");
const CasaProductStorage = require("../storages/CasaProductStorage");
const { isFullRefund } = require("../utils/refunds");
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

  // Assinaturas recorrentes próprias (comunidade privada / bolsa patrocínio)
  // têm linha própria — roteia por elas antes da assinatura de perfil.
  const membership = await CommunityMembershipService.handleInvoicePaid(invoice, subscriptionId);
  if (membership && !membership.ignored) return;
  const VaquinhaService = require("./VaquinhaService");
  if (typeof VaquinhaService.handleSponsorshipInvoicePaid === "function") {
    const sponsorship = await VaquinhaService.handleSponsorshipInvoicePaid(invoice, subscriptionId);
    if (sponsorship && !sponsorship.ignored) return;
  }

  const row = await ProfileSubscriptionStorage.findBySubscriptionId(
    conn,
    subscriptionId
  );
  if (!row) {
    // invoice.paid pode chegar ANTES do checkout.session.completed — nesse caso
    // nossa linha ainda não tem o subscription id. A metadata da subscription
    // (subscription_data.metadata) diz de quem é a fatura.
    try {
      const subscription = await StripeService.retrieveSubscription(subscriptionId);
      const metaType = subscription?.metadata?.type || null;
      if (metaType === "community_membership") {
        await CommunityMembershipService.handleInvoicePaidByMetadata(invoice, subscription);
        return;
      }
      if (metaType === "vaquinha_sponsorship" && typeof VaquinhaService.handleSponsorshipInvoicePaidByMetadata === "function") {
        await VaquinhaService.handleSponsorshipInvoicePaidByMetadata(invoice, subscription);
        return;
      }
    } catch (err) {
      log.warn("invoice.paid.subscription_lookup_fail", { subscriptionId, message: err.message });
    }
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

  const membership = await CommunityMembershipService.handleInvoiceFailed(subscriptionId);
  if (membership && !membership.ignored) return;
  const VaquinhaService = require("./VaquinhaService");
  if (typeof VaquinhaService.handleSponsorshipInvoiceFailed === "function") {
    const sponsorship = await VaquinhaService.handleSponsorshipInvoiceFailed(subscriptionId);
    if (sponsorship && !sponsorship.ignored) return;
  }

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
  // Reembolso parcial não reverte a ativação inteira — tratamento manual.
  if (!isFullRefund(charge)) {
    log.warn("charge.refunded.partial_ignored", {
      charge_id: charge.id,
      amount: charge.amount,
      amount_refunded: charge.amount_refunded,
    });
    return;
  }

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id || null;

  // Bundle de comunidade (R$100): estorno total reverte o teto +1/+1.
  // Encerra cedo — não é assinatura/pedido com comissão de afiliado.
  const communityReverted = await CommunitySlotService.revertRefundByPaymentIntent(
    conn,
    paymentIntentId,
    charge.id
  );
  if (communityReverted) return;

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
  const membership = await CommunityMembershipService.handleSubscriptionDeleted(subscription);
  if (membership && !membership.ignored) return;
  const VaquinhaService = require("./VaquinhaService");
  if (typeof VaquinhaService.handleSponsorshipDeleted === "function") {
    const sponsorship = await VaquinhaService.handleSponsorshipDeleted(subscription);
    if (sponsorship && !sponsorship.ignored) return;
  }

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
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id || null;

  let result;
  if (meta.type === "booking_deposit") {
    result = await BookingService.confirmBookingFromWebhook(session.id, paymentIntentId);
  } else if (meta.type === "clan_slot") {
    result = await ClanService.confirmSlotPurchaseFromWebhook(session.id, paymentIntentId);
  } else if (meta.type === "community_slot") {
    result = await CommunitySlotService.confirmStripeSession(session);
  } else if (meta.type === "community_membership") {
    result = await CommunityMembershipService.confirmStripeSession(session);
  } else if (meta.type === "manifestation") {
    result = await ManifestationService.confirmStripeSession(session);
  } else if (meta.type === "polen_purchase") {
    result = await PolenProductService.confirmStripeSession(session);
  } else if (meta.type === "xp_boost") {
    result = await XpBoostService.confirmStripeSession(session);
  } else if (meta.type === "premium") {
    result = await PremiumService.confirmStripeSession(session);
  } else if (meta.type === "course_purchase") {
    const CoursesService = require("./CoursesService");
    result = await CoursesService.confirmStripeSession(session);
  } else if (meta.type === "profile_product_order") {
    result = await ProfileProductOrderService.confirmStripeSession(session);
  } else if (meta.type === "casa_participant_order") {
    result = await CasaParticipantService.confirmStripeSession(session);
  } else if (meta.type === "donation") {
    const VaquinhaService = require("./VaquinhaService");
    result = await VaquinhaService.confirmStripeSession(session);
  } else if (meta.type === "vaquinha_sponsorship") {
    const VaquinhaService = require("./VaquinhaService");
    result = await VaquinhaService.confirmSponsorshipSession(session);
  } else {
    // Subscription/ativação — devolve undefined (gera comissão por outro caminho).
    result = await handleCheckoutCompleted(pool, session);
  }

  // A entrega falhou (estoque esgotado, premium já ativo, perfil já ativado…)
  // quando o confirmador devolve error/canceled. Nesse caso NÃO atribui comissão
  // de afiliado — senão o afiliado ganharia por uma venda que foi estornada.
  const delivered =
    !result ||
    (!result.error && !result.canceled && !result.order_canceled);
  if (!delivered) {
    log.info("commission.skip_undelivered", {
      session_id: session.id,
      meta_type: meta.type || null,
      reason: result?.error || (result?.canceled ? "canceled" : "order_canceled"),
    });
    return result;
  }

  // Atribuição de comissão para fluxos não-assinatura quando o cupom veio
  // capturado via ?cupom= no link. Idempotente por (provider, ref).
  await maybeAttributeCouponCommission(pool, session, meta);
  return result;
}

/**
 * Expira/cancela os registros pendentes de uma checkout session que NUNCA foi
 * paga (checkout.session.expired) ou cujo pagamento assíncrono falhou
 * (async_payment_failed). Sem isto, pedidos/poléns/premium/ativações ficavam
 * "pendente" para sempre e o slot da agenda ficava bloqueado. Idempotente:
 * só mexe em linhas ainda pendentes.
 */
async function expireCheckoutSession(session, reason) {
  const meta = session.metadata || {};
  try {
    switch (meta.type) {
      case "booking_deposit": {
        const expired = await BookingStorage.expireBySessionId(pool, session.id);
        if (expired) log.info("expire.booking", { session_id: session.id, reason });
        break;
      }
      case "polen_purchase": {
        const expired = await PolenProductStorage.markPurchaseExpiredBySession(pool, session.id);
        if (expired) log.info("expire.polen", { session_id: session.id, reason });
        break;
      }
      case "xp_boost": {
        const expired = await XpBoostStorage.markExpiredBySession(pool, session.id);
        if (expired) log.info("expire.xp_boost", { session_id: session.id, reason });
        break;
      }
      case "premium": {
        const pending = await PremiumStorage.getByStripeSession(pool, session.id);
        if (pending && !pending.is_active) {
          await PremiumStorage.markFailed(pool, pending.id);
          log.info("expire.premium", { session_id: session.id, reason });
        }
        break;
      }
      case "profile_product_order": {
        const order = await ProfileProductOrderStorage.getByStripeSession(pool, session.id);
        if (order && order.status === "pending") {
          await ProfileProductOrderStorage.markCanceled(pool, order.id_order);
          log.info("expire.order", { session_id: session.id, reason });
        }
        break;
      }
      case "casa_participant_order": {
        await CasaProductStorage.markOrderCanceled(pool, session.id);
        log.info("expire.casa", { session_id: session.id, reason });
        break;
      }
      case "manifestation":
      case "clan_slot":
        // Sem linha pendente persistida (o registro só nasce na confirmação).
        break;
      case "community_slot": {
        const ex = await CommunityStorage.markSlotPurchaseExpiredBySession(
          pool,
          session.id
        );
        if (ex) log.info("expire.community_slot", { session_id: session.id, reason });
        break;
      }
      case "community_membership": {
        const ex = await CommunityMembershipService.expireBySession(session.id);
        if (ex) log.info("expire.community_membership", { session_id: session.id, reason });
        break;
      }
      case "vaquinha_sponsorship": {
        const VaquinhaService = require("./VaquinhaService");
        const ex = await VaquinhaService.expireSponsorshipBySession(session.id);
        if (ex) log.info("expire.vaquinha_sponsorship", { session_id: session.id, reason });
        break;
      }
      default: {
        // Ativação/assinatura.
        const sub = await ProfileSubscriptionStorage.findBySessionId(pool, session.id);
        if (sub && sub.status === "pending") {
          await ProfileSubscriptionStorage.updateBySessionId(pool, session.id, {
            status: "expired",
          });
          log.info("expire.subscription", { session_id: session.id, reason });
        }
      }
    }
  } catch (err) {
    log.error("expire.fail", { session_id: session.id, reason, message: err.message });
  }
}

/**
 * O switch de roteamento de eventos. Separado de processEvent para que o
 * controle de idempotência/retry (claim → done/failed) e a reconciliação
 * (reprocessEvent) compartilhem exatamente a mesma lógica de despacho.
 */
async function dispatchEvent(event) {
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
      // Pagamento assíncrono falhou (ex.: Pix não pago no prazo). Limpa o
      // registro pendente para o comprador não ver "processando" eternamente.
      log.warn("checkout.async_payment_failed", {
        session_id: session.id,
        meta_type: session.metadata?.type || null,
      });
      await expireCheckoutSession(session, "async_payment_failed");
      break;
    }
    case "checkout.session.expired": {
      const session = event.data.object;
      // Session abandonada/expirada sem pagamento — libera estoque/slot e
      // marca o pendente como expirado.
      log.info("checkout.session.expired", {
        session_id: session.id,
        meta_type: session.metadata?.type || null,
      });
      await expireCheckoutSession(session, "expired");
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
      const xpBoostResult = await XpBoostService.handleChargeRefunded(charge);
      if (xpBoostResult && !xpBoostResult.ignored) break;
      const premiumResult = await PremiumService.handleChargeRefunded(charge);
      if (premiumResult && !premiumResult.ignored) break;
      const CoursesService = require("./CoursesService");
      const courseResult = await CoursesService.handleChargeRefunded(charge);
      if (courseResult && !courseResult.ignored) break;
      const VaquinhaService = require("./VaquinhaService");
      const vaquinhaResult = await VaquinhaService.handleChargeRefunded(charge);
      if (vaquinhaResult && !vaquinhaResult.ignored) break;
      const membershipResult = await CommunityMembershipService.handleChargeRefunded(charge);
      if (membershipResult && !membershipResult.ignored) break;
      await handleChargeRefunded(pool, charge);
      break;
    }
    default:
      log.debug("unhandled.event", { type: event.type });
  }
}

/**
 * Processa um evento Stripe já verificado. At-least-once via
 * tb_stripe_webhook_event: o evento é reivindicado como 'pending', e só vira
 * 'done' se o despacho terminar sem erro. Se estourar, fica 'failed' e o
 * retry do Stripe (ou o admin) reprocessa — em vez de perder o pagamento.
 */
async function processEvent(event) {
  const { duplicate } = await StripeWebhookEventStorage.claim(pool, {
    event_id: event.id,
    event_type: event.type,
    payload: event,
  });

  if (duplicate) {
    log.info("duplicate.skip", { event_id: event.id, type: event.type });
    return { duplicate: true };
  }

  try {
    await dispatchEvent(event);
    await StripeWebhookEventStorage.markDone(pool, event.id);
    return { ok: true };
  } catch (err) {
    await StripeWebhookEventStorage.markFailed(pool, event.id, err.message);
    // Re-lança: o controller devolve 500, o Stripe re-tenta e o claim
    // re-reivindica a linha 'failed' para uma nova tentativa.
    throw err;
  }
}

/**
 * Reprocessa um evento já armazenado (botão admin / reconciliação). Usa o
 * payload persistido. Marca 'done' em caso de sucesso, 'failed' caso contrário.
 */
async function reprocessEvent(event_id) {
  const row = await StripeWebhookEventStorage.getByEventId(pool, event_id);
  if (!row) return { error: "event_not_found" };
  try {
    await dispatchEvent(row.payload);
    await StripeWebhookEventStorage.markDone(pool, event_id);
    return { ok: true, event_id };
  } catch (err) {
    await StripeWebhookEventStorage.markFailed(pool, event_id, err.message);
    return { error: err.message, event_id };
  }
}

module.exports = { processEvent, reprocessEvent, fulfillCheckoutSession, dispatchEvent };
