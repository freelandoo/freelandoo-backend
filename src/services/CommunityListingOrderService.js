// src/services/CommunityListingOrderService.js
//
// VENDER DENTRO DA VITRINE (mig 249) — o checkout vizinho-a-vizinho.
//
// Até aqui o anúncio da mig 198 NÃO VENDIA: ele tinha um campo `contact` e a
// venda acontecia fora da plataforma. O pedido do Alex — "uma venda foi feita
// de um serviço ou produto; se precisar que alguém busque na recepção, quem
// comprou pode pagar R$3 a mais" — pressupunha um checkout que não existia.
//
// ─── ⚠️ O HOLDBACK DE 8 DIAS VOLTA A VALER AQUI ─────────────────────────────
//
// E é o OPOSTO do delivery (mig 248), de propósito. Não é uma inconsistência:
//
//   delivery  → serviço EM MÃOS no prédio, confirmado na hora. Não há
//               arrependimento de uma corrida que terminou, e segurar R$1,01
//               por oito dias mataria a feature.
//   venda     → compra de bem/serviço. CDC: 7 dias de arrependimento, e o
//               dinheiro precisa estar disponível para voltar.
//
// NÃO UNIFICAR OS DOIS. Quem "consertar" um deles por simetria está trocando
// uma decisão jurídica por elegância de código.
//
// ─── A DISPUTA É O QUE TORNA ISTO ENTREGÁVEL ────────────────────────────────
//
// Pôr dinheiro entre vizinhos sem um caminho de "não chegou / não era isso" é
// pior que não ter checkout: a plataforma vira a culpada de uma briga de
// corredor sem ter como resolvê-la. Abrir disputa CONGELA o repasse; quem
// decide é o ADMIN DA PLATAFORMA — não o síndico, que é vizinho dos dois lados.
//
// ─── O "+R$3" É UM ADD-ON DO MESMO CHECKOUT ─────────────────────────────────
//
// Quem compra marca "preciso que tragam" e paga `preço + entrega` DE UMA VEZ.
// Quando o pagamento cai, abre-se um chamado da mig 248 **já pago**
// (`id_listing_order` preenchido), e o aceite dele NÃO cobra de novo. Sem essa
// marca, o vizinho pagaria a entrega duas vezes.

const pool = require("../databases");
const CommunityListingOrderStorage = require("../storages/CommunityListingOrderStorage");
const CommunityListingStorage = require("../storages/CommunityListingStorage");
const CommunityDeliveryStorage = require("../storages/CommunityDeliveryStorage");
const StoreGovernanceService = require("./StoreGovernanceService");
const NotificationService = require("./NotificationService");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const { isFullRefund } = require("../utils/refunds");
const { territorialContext } = require("../utils/territorialCommunity");
const {
  getListingSettings,
  platformFeeFor,
  computeOrder,
} = require("../utils/listingOrder");
const {
  estimateProcessorFee,
  getDeliveryType,
  isDeliveryKind,
} = require("../utils/deliveryPricing");
const { createLogger, runWithLogs } = require("../utils/logger");
const realtime = require("../realtime/socket");

const log = createLogger("CommunityListingOrderService");

const FLAG = "vitrine_venda";
const MAX_NOTE = 500;
const DISPUTE_REASONS = ["not_received", "not_as_described", "other"];

function communityIdOf(params) {
  return params?.id_profile || params?.id_community || null;
}

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function push(userIds, payload) {
  try {
    for (const id of new Set((userIds || []).filter(Boolean).map(String))) {
      realtime.emitToUser(id, "listing-order:changed", payload);
    }
  } catch {
    /* realtime é best-effort */
  }
}

class CommunityListingOrderService {
  /**
   * ⚠️ A FLAG BARRA COMPRAR, NUNCA CONCLUIR. Desligar o kill-switch segura o
   * que ainda não nasceu; prender um pedido já pago faria o dinheiro do vizinho
   * ficar parado porque o admin apertou um interruptor.
   */
  static async _ctx(id_user, params, { require: level = "resident", checkFlag = true } = {}) {
    const ctx = await territorialContext(pool, id_user, communityIdOf(params), { require: level });
    if (ctx.error) return ctx;
    if (checkFlag) {
      const FeatureFlagService = require("./FeatureFlagService");
      let enabled = true;
      try {
        enabled = await FeatureFlagService.isEnabled(FLAG);
      } catch {
        enabled = true; // fail-open, como o requireFeature
      }
      if (!enabled) {
        return { error: "Recurso indisponível no momento.", statusCode: 403, feature_disabled: FLAG };
      }
    }
    return ctx;
  }

  /* ------------------------------- checkout ------------------------------- */

  static async checkout(user, params, body) {
    return runWithLogs(
      log,
      "checkout",
      () => ({ id_user: user?.id_user, id_listing: params?.id_listing }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        const listing = await CommunityListingStorage.getById(
          pool,
          ctx.community.id_profile,
          params.id_listing
        );
        if (!listing || listing.status !== "active") {
          return { error: "Anúncio não encontrado.", statusCode: 404 };
        }
        if (String(listing.id_user) === String(user.id_user)) {
          // Comprar de si mesmo é um pedido que nasce para ser cancelado — e,
          // pior, uma forma de mover dinheiro em círculo pagando só a tarifa.
          return { error: "Este anúncio é seu.", statusCode: 400 };
        }
        const price = Number(listing.price_cents);
        if (!Number.isFinite(price) || price <= 0) {
          // Anúncio sem preço é convite para conversar, não para comprar. O
          // front já esconde o botão; aqui é a porta que confirma.
          return {
            error: "Este anúncio não tem preço — fale com o vizinho pelo contato do anúncio.",
            statusCode: 400,
          };
        }

        // ── o add-on "+R$3" ────────────────────────────────────────────────
        // O preço da entrega sai da MESMA tabela admin-editável do delivery
        // (mig 248). Um segundo lugar guardando esse número faria a vitrine
        // cobrar R$3 no dia em que o painel já dissesse R$4.
        let deliveryCents = 0;
        let deliveryKind = null;
        if (body?.delivery_kind) {
          if (!isDeliveryKind(body.delivery_kind)) {
            return { error: "Tipo de entrega inválido.", statusCode: 400 };
          }
          const type = await getDeliveryType(pool, body.delivery_kind);
          if (!type) {
            return { error: "Esta entrega não está disponível agora.", statusCode: 400 };
          }
          deliveryKind = type.kind;
          deliveryCents = Number(type.price_cents) || 0;
        }

        const [settings, governance] = await Promise.all([
          getListingSettings(pool),
          StoreGovernanceService.getSettings(),
        ]);
        const platformFee = platformFeeFor(price, settings);
        const estimate = estimateProcessorFee(price + deliveryCents, governance);
        const money = computeOrder({
          priceCents: price,
          deliveryCents,
          platformFeeCents: platformFee,
          processorFeeCents: estimate.cents,
        });
        if (money.shortfall_cents > 0) {
          // Não impede a compra: é sinal de preço mal calibrado para a tarifa
          // vigente, e quem perde é a plataforma, não o vizinho.
          log.warn("listing_order.shortfall", {
            id_listing: listing.id_listing,
            shortfall_cents: money.shortfall_cents,
          });
        }

        // (1) o pedido nasce ANTES da rede — a mesma ordem do PaymentGateway.
        // Invertido, uma falha no meio da criação da cobrança deixaria o
        // checkout de pé no gateway sem linha nenhuma aqui.
        const order = await CommunityListingOrderStorage.create(pool, {
          id_listing: listing.id_listing,
          id_community: ctx.community.id_profile,
          id_buyer: user.id_user,
          id_seller: listing.id_user,
          listing_title: listing.title,
          listing_kind: listing.kind,
          price_cents: price,
          delivery_cents: deliveryCents,
          delivery_kind: deliveryKind,
          amount_cents: money.amount_cents,
          platform_fee_cents: money.platform_fee_cents,
          processor_fee_cents: money.processor_fee_cents,
          processor_fee_source: estimate.source,
          seller_cents: money.seller_cents,
          courier_cents: money.courier_cents,
          note: clean(body?.note, MAX_NOTE),
        });

        try {
          const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(
            /\/$/,
            ""
          );
          const back = `${frontend}/comunidades/${ctx.community.id_profile}/compras`;
          const session = await PaymentGateway.createCheckout({
            amount_cents: money.amount_cents,
            currency: "BRL",
            productName: `${listing.title} — ${ctx.community.display_name}`,
            customerEmail: user.email || undefined,
            clientReferenceId: user.id_user,
            successUrl: `${back}?compra=success&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${back}?compra=cancel`,
            metadata: {
              type: "community_listing_order",
              user_id: user.id_user,
              id_community: ctx.community.id_profile,
              id_order: String(order.id_order),
            },
          });

          const charged = await CommunityListingOrderStorage.attachCharge(pool, order.id_order, {
            provider: providerOf(session),
            session_id: session.id,
            provider_ref: session.provider_ref || session.id,
            checkout_url: session.url || null,
          });

          return { order: charged, checkout_url: session.url, session_id: session.id };
        } catch (err) {
          log.error("listing_order.charge.fail", {
            id_order: order.id_order,
            message: err?.message,
          });
          await CommunityListingOrderStorage.markCanceled(pool, order.session_id || "");
          return { error: "Não foi possível iniciar o pagamento. Tente de novo.", statusCode: 502 };
        }
      }
    );
  }

  /* -------------------------------- leitura ------------------------------- */

  static async listMine(user, params, query) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const id_community = communityIdOf(params);
      const [bought, sold, payouts, summary] = await Promise.all([
        CommunityListingOrderStorage.listForUser(pool, user.id_user, {
          role: "buyer",
          id_community,
          limit: query?.limit,
        }),
        CommunityListingOrderStorage.listForUser(pool, user.id_user, {
          role: "seller",
          id_community,
          limit: query?.limit,
        }),
        CommunityListingOrderStorage.listPayoutsForSeller(pool, user.id_user, { limit: 50 }),
        CommunityListingOrderStorage.summaryForSeller(pool, user.id_user),
      ]);
      // ⚠️ A URL DE PAGAMENTO SÓ VAI PARA QUEM COMPROU. Ela é uma sessão de
      // checkout no nome dele; no lado do vendedor, ela seria um link para
      // pagar a própria venda.
      return {
        bought,
        sold: sold.map((o) => ({ ...o, checkout_url: undefined })),
        payouts,
        summary,
      };
    });
  }

  /* ------------------------ entrega e confirmação ------------------------- */

  static async markDelivered(user, params) {
    return runWithLogs(
      log,
      "markDelivered",
      () => ({ id_user: user?.id_user, id_order: params?.id_order }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const settings = await getListingSettings(pool);
        const now = new Date();
        const row = await CommunityListingOrderStorage.markDelivered(
          pool,
          params.id_order,
          user.id_user,
          {
            delivered_at: now,
            confirm_due_at: new Date(now.getTime() + settings.confirm_days * 86400000),
          }
        );
        if (!row) {
          return {
            error: "Só quem vendeu marca a entrega, e só depois do pagamento.",
            statusCode: 403,
          };
        }
        this._notify(row, "listing_order_paid", row.id_buyer, user.id_user).catch(() => {});
        push([row.id_buyer, row.id_seller], { id_order: row.id_order, status: row.status });
        return { order: row };
      }
    );
  }

  /** Quem COMPROU confirma que recebeu → começa a contar o holdback. */
  static async confirm(user, params) {
    return runWithLogs(
      log,
      "confirm",
      () => ({ id_user: user?.id_user, id_order: params?.id_order }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const order = await CommunityListingOrderStorage.getById(pool, params.id_order);
        if (!order || String(order.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Pedido não encontrado.", statusCode: 404 };
        }
        if (String(order.id_buyer) !== String(user.id_user)) {
          return { error: "Só quem comprou pode confirmar.", statusCode: 403 };
        }

        const done = await CommunityListingOrderStorage.markCompleted(pool, params.id_order, {
          completed_at: new Date(),
        });
        if (!done) {
          return {
            error:
              order.status === "disputed"
                ? "Este pedido está em disputa — espere a decisão."
                : "Este pedido ainda não foi marcado como entregue.",
            statusCode: 409,
          };
        }
        this._notify(done, "listing_order_confirmed", done.id_seller, user.id_user).catch(() => {});
        push([done.id_buyer, done.id_seller], { id_order: done.id_order, status: done.status });
        return { order: done };
      }
    );
  }

  /* -------------------------------- disputa ------------------------------- */

  static async openDispute(user, params, body) {
    return runWithLogs(
      log,
      "openDispute",
      () => ({ id_user: user?.id_user, id_order: params?.id_order }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const order = await CommunityListingOrderStorage.getById(pool, params.id_order);
        if (!order || String(order.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Pedido não encontrado.", statusCode: 404 };
        }
        if (String(order.id_buyer) !== String(user.id_user)) {
          return { error: "Só quem comprou pode abrir uma disputa.", statusCode: 403 };
        }
        // ⚠️ A JANELA DA DISPUTA É A DO HOLDBACK. Depois que o dinheiro foi
        // liberado, não há o que congelar — e prometer disputa fora da janela
        // seria um botão que aceita o clique e não faz nada.
        const payout = await CommunityListingOrderStorage.getPayoutByOrder(pool, order.id_order);
        if (payout && payout.status !== "aguardando") {
          return {
            error: "O prazo de contestação deste pedido já passou. Fale com o suporte.",
            statusCode: 409,
          };
        }
        // ⚠️ `completed` ESTÁ NA LISTA, e a ausência dele era um buraco de UM
        // DIA INTEIRO. A confirmação vence em 7 dias (o pedido conclui sozinho)
        // e o holdback só termina em 8: entre um e outro existe um dia em que o
        // dinheiro ainda está retido e o comprador — justamente o que não
        // confirmou porque nada chegou — ficava sem poder contestar. Quem manda
        // na janela é o REPASSE (a checagem logo acima), não o status do
        // pedido.
        if (!["paid", "delivered", "disputed", "completed"].includes(order.status)) {
          return { error: "Este pedido não pode ser contestado.", statusCode: 409 };
        }

        const reason = DISPUTE_REASONS.includes(body?.reason) ? body.reason : "other";
        const dispute = await CommunityListingOrderStorage.openDispute(pool, {
          id_order: order.id_order,
          id_opener: user.id_user,
          reason,
          detail: clean(body?.detail, 1000),
        });
        await CommunityListingOrderStorage.markDisputed(pool, order.id_order);

        this._notify(order, "listing_order_disputed", order.id_seller, user.id_user).catch(() => {});
        push([order.id_buyer, order.id_seller], { id_order: order.id_order, status: "disputed" });
        return { dispute };
      }
    );
  }

  /** A fila do admin da PLATAFORMA (não do síndico — ver o cabeçalho). */
  static async listDisputes() {
    return runWithLogs(log, "listDisputes", () => ({}), async () => {
      const items = await CommunityListingOrderStorage.listOpenDisputes(pool);
      return { disputes: items };
    });
  }

  /**
   * O veredito.
   *
   * `refund`  → o dinheiro volta INTEIRO ao comprador e o repasse é revertido.
   * `release` → a venda segue e o repasse é liberado na hora (o holdback já
   *             cumpriu o papel dele: o caso foi olhado por gente).
   */
  static async decideDispute(admin, params, body) {
    return runWithLogs(
      log,
      "decideDispute",
      () => ({ id_user: admin?.id_user, id_dispute: params?.id_dispute, verdict: body?.verdict }),
      async () => {
        const verdict = body?.verdict === "refund" ? "refund" : "release";
        const r = await pool.query(
          `SELECT d.*, o.provider_ref, o.id_order, o.id_buyer, o.id_seller
             FROM public.tb_community_listing_dispute d
             JOIN public.tb_community_listing_order o ON o.id_order = d.id_order
            WHERE d.id_dispute = $1 AND d.status = 'open'
            LIMIT 1`,
          [params.id_dispute]
        );
        const dispute = r.rows[0];
        if (!dispute) return { error: "Disputa não encontrada ou já decidida.", statusCode: 404 };

        if (verdict === "refund") {
          if (dispute.provider_ref) {
            try {
              // ⚠️ O ESTORNO SAI DA INTENÇÃO (`provider_ref`), nunca do
              // prefixo do id: `sub_` colide entre Stripe e Asaas.
              await PaymentGateway.refund({ provider_ref: dispute.provider_ref });
            } catch (err) {
              log.error("dispute.refund.fail", {
                id_order: dispute.id_order,
                message: err?.message,
              });
              return { error: "Não foi possível estornar no gateway.", statusCode: 502 };
            }
          }
          await CommunityListingOrderStorage.revertPayout(pool, dispute.id_order);
          await CommunityListingOrderStorage.markRefunded(pool, dispute.id_order);
        } else {
          await CommunityListingOrderStorage.undispute(pool, dispute.id_order);
          await CommunityListingOrderStorage.markCompleted(pool, dispute.id_order, {
            completed_at: new Date(),
          });
          await CommunityListingOrderStorage.approvePayout(pool, dispute.id_order);
        }

        const decided = await CommunityListingOrderStorage.decideDispute(pool, params.id_dispute, {
          status: verdict === "refund" ? "refunded" : "released",
          decided_by: admin?.id_user || null,
          decision_note: clean(body?.note, 1000),
        });

        const order = await CommunityListingOrderStorage.getById(pool, dispute.id_order);
        for (const target of [dispute.id_buyer, dispute.id_seller]) {
          this._notify(order, "listing_order_resolved", target, admin?.id_user).catch(() => {});
        }
        push([dispute.id_buyer, dispute.id_seller], {
          id_order: dispute.id_order,
          status: order?.status,
        });
        return { dispute: decided, order };
      }
    );
  }

  /* -------------------------------- webhook ------------------------------- */

  /**
   * O pagamento caiu.
   *
   * ⚠️ IDEMPOTENTE POR SESSION ID. A reentrega do webhook (at-least-once) sai
   * por `{ already: true }` — nunca abrindo uma segunda entrega nem um segundo
   * repasse.
   *
   * ⚠️ E A ORDEM É: apura a tarifa → recalcula os DOIS líquidos → escreve o
   * repasse. É o repasse que vira saque; rodando antes, a venda ficaria certa e
   * o dinheiro errado. Mesma ordem do `BookingService`.
   */
  static async confirmStripeSession(session) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

    const row = await CommunityListingOrderStorage.markPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await CommunityListingOrderStorage.getBySession(pool, session.id);
      if (existing && existing.status !== "pending") return { already: true };
      return { error: "Pedido não encontrado para esta sessão." };
    }

    let order = row;
    try {
      const fee = await PaymentGateway.getChargeFee(paymentIntentId || row.provider_ref);
      const cents = Number(fee?.fee_cents);
      if (Number.isFinite(cents)) {
        const money = computeOrder({
          priceCents: row.price_cents,
          deliveryCents: row.delivery_cents,
          platformFeeCents: row.platform_fee_cents,
          processorFeeCents: Math.max(0, Math.round(cents)),
        });
        const updated = await CommunityListingOrderStorage.applyProcessorFee(pool, row.id_order, {
          fee_cents: money.processor_fee_cents,
          seller_cents: money.seller_cents,
          courier_cents: money.courier_cents,
        });
        if (updated) {
          order = updated;
          log.info("listing_order.processor_fee.applied", {
            id_order: row.id_order,
            estimated_cents: Number(row.processor_fee_cents) || 0,
            real_cents: money.processor_fee_cents,
            seller_cents: money.seller_cents,
            courier_cents: money.courier_cents,
          });
        }
      } else {
        log.warn("listing_order.processor_fee.unavailable", { id_order: row.id_order });
      }
    } catch (err) {
      // Falha de apuração não derruba a confirmação de um pagamento que já
      // aconteceu — a venda vale, e o repasse sai na estimativa.
      log.warn("listing_order.processor_fee.fail", {
        id_order: row.id_order,
        message: err?.message,
      });
    }

    // ── o repasse, com HOLDBACK ───────────────────────────────────────────
    try {
      const settings = await getListingSettings(pool);
      await CommunityListingOrderStorage.createPayout(pool, {
        id_order: order.id_order,
        id_community: order.id_community,
        id_seller: order.id_seller,
        listing_title: order.listing_title,
        charge_cents: Number(order.amount_cents) || 0,
        platform_fee_cents: Number(order.platform_fee_cents) || 0,
        processor_fee_cents: Number(order.processor_fee_cents) || 0,
        net_cents: Number(order.seller_cents) || 0,
        available_at: new Date(Date.now() + settings.holdback_days * 86400000),
      });
    } catch (err) {
      log.error("listing_order.payout.fail", { id_order: order.id_order, message: err?.message });
    }

    // ── o "+R$3": um chamado de entrega JÁ PAGO ───────────────────────────
    if (Number(order.delivery_cents) > 0 && order.delivery_kind && !order.id_delivery) {
      try {
        await this._openPaidDelivery(order);
      } catch (err) {
        log.error("listing_order.delivery.fail", {
          id_order: order.id_order,
          message: err?.message,
        });
      }
    }

    this._notify(order, "listing_order_new", order.id_seller, order.id_buyer).catch(() => {});
    push([order.id_buyer, order.id_seller], { id_order: order.id_order, status: order.status });
    return { order };
  }

  static async expireBySession(session_id) {
    const row = await CommunityListingOrderStorage.markCanceled(pool, session_id);
    return !!row;
  }

  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const order = await CommunityListingOrderStorage.getByProviderRef(pool, paymentIntentId);
    if (!order) return { ignored: true };

    if (!isFullRefund(charge)) {
      log.warn("listing_order.refund.partial_ignored", {
        id_order: order.id_order,
        amount_refunded: charge.amount_refunded,
      });
      return { handled: false, partial: true };
    }
    if (order.refunded_at) return { handled: true, duplicate: true };

    await CommunityListingOrderStorage.revertPayout(pool, order.id_order);
    await CommunityListingOrderStorage.markRefunded(pool, order.id_order);
    log.info("listing_order.refunded", { id_order: order.id_order });
    return { handled: true };
  }

  /* ------------------------------- sweepers ------------------------------- */

  /**
   * Dois varredores no mesmo tique, porque eles guardam as duas pontas do
   * tempo da venda:
   *  (1) entregue e não confirmado no prazo → conclui sozinho;
   *  (2) holdback vencido → o repasse vira saldo sacável.
   *
   * ⚠️ O (2) PULA O QUE ESTÁ EM DISPUTA (a cláusula EXISTS do storage). Sem
   * ela, o dinheiro de uma briga aberta seria liberado quando o prazo batesse,
   * e a disputa seria um formulário que não segura nada.
   */
  static async sweep() {
    return runWithLogs(log, "sweep", () => ({}), async () => {
      const completed = await CommunityListingOrderStorage.releaseDueConfirmations(pool);
      for (const o of completed) {
        push([o.id_buyer, o.id_seller], { id_order: o.id_order, status: "completed" });
      }
      const released = await CommunityListingOrderStorage.releaseDuePayouts(pool);
      if (completed.length || released.length) {
        log.info("listing_order.sweep", {
          auto_completed: completed.length,
          payouts_released: released.length,
        });
      }
      return { completed: completed.length, released: released.length };
    });
  }

  /* ------------------------------- internos ------------------------------- */

  /**
   * Abre o chamado de entrega que o add-on pagou.
   *
   * ⚠️ ELE NASCE `payment_status = 'paid'` E COM `id_listing_order`. As duas
   * marcas importam: sem a primeira o `_createPayout` do delivery recusaria o
   * repasse por achar que ninguém pagou; sem a segunda, o ACEITE criaria uma
   * segunda cobrança e o vizinho pagaria a entrega duas vezes.
   *
   * O `courier_cents` já vem calculado do pedido (com a tarifa rateada), então
   * quem aceitar recebe exatamente o que a tela prometeu.
   */
  static async _openPaidDelivery(order) {
    const type = await getDeliveryType(pool, order.delivery_kind, { onlyActive: false });
    const minutes = Number(type?.expires_minutes) || 1440;
    const delivery = await CommunityDeliveryStorage.create(pool, {
      id_community: order.id_community,
      id_requester: order.id_buyer,
      kind: order.delivery_kind,
      price_cents: Number(order.delivery_cents) || 0,
      note: `${order.listing_title}`,
      expires_at: new Date(Date.now() + minutes * 60 * 1000),
    });
    await pool.query(
      `UPDATE public.tb_community_delivery_request
          SET id_listing_order = $2,
              payment_status = 'paid',
              payment_provider = $3,
              provider_ref = $4,
              processor_fee_cents = $5,
              processor_fee_source = $6,
              courier_cents = $7,
              updated_at = NOW()
        WHERE id_delivery = $1`,
      [
        delivery.id_delivery,
        order.id_order,
        order.payment_provider,
        order.provider_ref,
        Math.max(0, Number(order.processor_fee_cents) || 0),
        order.processor_fee_source || "fallback",
        Math.max(0, Number(order.courier_cents) || 0),
      ]
    );
    await CommunityListingOrderStorage.attachDelivery(pool, order.id_order, delivery.id_delivery);
    log.info("listing_order.delivery_opened", {
      id_order: order.id_order,
      id_delivery: delivery.id_delivery,
    });
    return delivery;
  }

  static async _notify(order, type, recipient, actor) {
    if (!order || !recipient) return null;
    return NotificationService.notifyListingOrder({
      recipient_user_id: recipient,
      actor_user_id: actor || null,
      type,
      id_community: order.id_community,
      id_order: order.id_order,
      title: order.listing_title,
      amount_cents: order.amount_cents,
    });
  }
}

module.exports = CommunityListingOrderService;
