// src/services/VaquinhaService.js
// Vaquinha (campanha de doação). Doações via Stripe caem no Saldo do criador
// (holdback 8 dias, espelha BookingPayout) menos a taxa da plataforma.
const pool = require("../databases");
const VaquinhaStorage = require("../storages/VaquinhaStorage");
const StripeService = require("./StripeService");
const { processPortfolioMedia } = require("../utils/mediaJobs");
const uploadVaquinhaMediaToR2 = require("../integrations/r2/uploadVaquinhaMedia");
const uploadVaquinhaCoverToR2 = require("../integrations/r2/uploadVaquinhaCover");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("VaquinhaService");
const HOLDBACK_DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// Placeholders da vaquinha criada "na própria pele" (nasce ativa e editável
// inline na própria página, sem formulário prévio).
const DRAFT_TITLE = "Minha vaquinha";
const DRAFT_GOAL_CENTS = 100000; // R$ 1.000
const DRAFT_DEADLINE_DAYS = 30;

function slugify(s) {
  return (
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "vaquinha"
  );
}

async function uniqueSlug(db, title) {
  const base = slugify(title);
  for (let i = 0; i < 6; i++) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const slug = `${base}-${suffix}`;
    if (!(await VaquinhaStorage.slugExists(db, slug))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function publicShape(v) {
  return {
    id_vaquinha: v.id_vaquinha,
    id_user: v.id_user,
    kind: v.kind || "vaquinha",
    title: v.title,
    slug: v.slug,
    bio: v.bio,
    cover_url: v.cover_url,
    goal_cents: Number(v.goal_cents),
    raised_cents: Number(v.raised_cents),
    donors_count: Number(v.donors_count),
    deadline: v.deadline,
    status: v.status,
    created_at: v.created_at,
    ended_at: v.ended_at,
  };
}

// Bolsa não tem prazo — só "expira" se for encerrada manualmente.
function isExpired(v) {
  if (v.status !== "active") return true;
  if (v.kind === "bolsa" || !v.deadline) return false;
  return new Date(v.deadline).getTime() < Date.now();
}

class VaquinhaService {
  // ─── Dono ──────────────────────────────────────────────────────────────────
  static async getMine(user) {
    return runWithLogs(log, "getMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      await VaquinhaStorage.closeExpiredForUser(pool, user.id_user);
      const v = await VaquinhaStorage.getActiveByUser(pool, user.id_user);
      return { vaquinha: v ? publicShape(v) : null };
    });
  }

  // Cria-ou-abre: se já existe uma vaquinha ativa, retorna ela; senão cria uma
  // nova já ativa com placeholders (editável inline na própria página).
  static async getOrCreate(user) {
    return runWithLogs(log, "getOrCreate", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      await VaquinhaStorage.closeExpiredForUser(pool, user.id_user);
      const existing = await VaquinhaStorage.getActiveByUser(pool, user.id_user);
      if (existing) return { vaquinha: publicShape(existing) };

      const slug = await uniqueSlug(pool, DRAFT_TITLE);
      const created = await VaquinhaStorage.create(pool, {
        id_user: user.id_user,
        title: DRAFT_TITLE,
        slug,
        bio: null,
        cover_url: null,
        goal_cents: DRAFT_GOAL_CENTS,
        deadline: new Date(Date.now() + DRAFT_DEADLINE_DAYS * DAY_MS),
      });
      return { vaquinha: publicShape(created), created: true };
    });
  }

  static async create(user, body = {}) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const settings = await VaquinhaStorage.getSettings(pool);

      const title = String(body.title || "").trim().slice(0, 120);
      if (!title) return { error: "Título é obrigatório", statusCode: 400 };

      const goal_cents = Math.round(Number(body.goal_cents));
      if (!Number.isFinite(goal_cents) || goal_cents <= 0) {
        return { error: "Meta inválida", statusCode: 400 };
      }

      const kind = body.kind === "bolsa" ? "bolsa" : "vaquinha";
      let deadline = null;
      if (kind === "vaquinha") {
        const deadlineMs = new Date(body.deadline).getTime();
        if (!Number.isFinite(deadlineMs)) return { error: "Prazo inválido", statusCode: 400 };
        const maxMs = Date.now() + Number(settings.max_days) * DAY_MS;
        if (deadlineMs <= Date.now()) return { error: "O prazo precisa ser no futuro", statusCode: 400 };
        if (deadlineMs > maxMs + DAY_MS) {
          return { error: `O prazo máximo é de ${settings.max_days} dias`, statusCode: 400 };
        }
        deadline = new Date(deadlineMs);
      }

      // Fecha a anterior vencida antes de checar a regra de "1 ativa".
      await VaquinhaStorage.closeExpiredForUser(pool, user.id_user);
      const existing = await VaquinhaStorage.getActiveByUser(pool, user.id_user);
      if (existing) {
        return { error: "Você já tem uma vaquinha ativa. Encerre-a para criar outra.", statusCode: 409 };
      }

      const slug = await uniqueSlug(pool, title);
      const created = await VaquinhaStorage.create(pool, {
        id_user: user.id_user,
        title,
        slug,
        bio: String(body.bio || "").slice(0, 3000),
        cover_url: body.cover_url ? String(body.cover_url).slice(0, 500) : null,
        goal_cents,
        deadline,
        kind,
      });
      return { vaquinha: publicShape(created) };
    });
  }

  static async update(user, id, body = {}) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getById(pool, id);
      if (!v || v.id_user !== user.id_user) return { error: "Vaquinha não encontrada", statusCode: 404 };
      if (v.status !== "active") return { error: "Vaquinha encerrada", statusCode: 400 };

      const fields = {};
      if (body.title !== undefined) {
        const t = String(body.title).trim().slice(0, 120);
        if (!t) return { error: "Título é obrigatório", statusCode: 400 };
        fields.title = t;
      }
      if (body.bio !== undefined) fields.bio = String(body.bio).slice(0, 3000);
      if (body.cover_url !== undefined) fields.cover_url = body.cover_url ? String(body.cover_url).slice(0, 500) : null;
      if (body.goal_cents !== undefined) {
        const g = Math.round(Number(body.goal_cents));
        if (!Number.isFinite(g) || g <= 0) return { error: "Meta inválida", statusCode: 400 };
        fields.goal_cents = g;
      }
      if (body.deadline !== undefined) {
        const settings = await VaquinhaStorage.getSettings(pool);
        const deadlineMs = new Date(body.deadline).getTime();
        if (!Number.isFinite(deadlineMs)) return { error: "Prazo inválido", statusCode: 400 };
        if (deadlineMs <= Date.now()) return { error: "O prazo precisa ser no futuro", statusCode: 400 };
        if (deadlineMs > Date.now() + Number(settings.max_days) * DAY_MS + DAY_MS) {
          return { error: `O prazo máximo é de ${settings.max_days} dias`, statusCode: 400 };
        }
        fields.deadline = new Date(deadlineMs);
      }

      // Troca de tipo: vaquinha ⇄ bolsa patrocínio.
      if (body.kind !== undefined && body.kind !== v.kind) {
        if (!["vaquinha", "bolsa"].includes(body.kind)) {
          return { error: "Tipo inválido (vaquinha|bolsa)", statusCode: 400 };
        }
        if (body.kind === "bolsa") {
          // Bolsa não tem validade — o prazo é apagado.
          fields.kind = "bolsa";
          fields.deadline = null;
        } else {
          // bolsa → vaquinha: só sem patrocínios vivos (senão as cobranças
          // mensais ficariam órfãs) e com um novo prazo definido.
          const live = await VaquinhaStorage.listLiveSponsorships(pool, id);
          if (live.length > 0) {
            return {
              error: "Encerre os patrocínios ativos antes de voltar para vaquinha.",
              statusCode: 409,
            };
          }
          if (fields.deadline === undefined || fields.deadline === null) {
            return { error: "Defina um prazo para a vaquinha.", statusCode: 400 };
          }
          fields.kind = "vaquinha";
        }
      }

      const updated = await VaquinhaStorage.update(pool, id, fields);
      return { vaquinha: publicShape(updated) };
    });
  }

  // Upload da capa (banner) — imagem para R2 (vaquinha-covers/<id>/).
  static async uploadCover(user, id, file) {
    return runWithLogs(log, "uploadCover", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getById(pool, id);
      if (!v || v.id_user !== user.id_user) return { error: "Vaquinha não encontrada", statusCode: 404 };
      if (v.status !== "active") return { error: "Vaquinha encerrada", statusCode: 400 };
      if (!file?.buffer) return { error: "Imagem obrigatória", statusCode: 400 };
      if (!String(file.mimetype || "").toLowerCase().startsWith("image/")) {
        return { error: "Envie uma imagem", statusCode: 400 };
      }
      const { url } = await uploadVaquinhaCoverToR2({ id_vaquinha: id, file });
      const updated = await VaquinhaStorage.update(pool, id, { cover_url: url });
      return { vaquinha: publicShape(updated) };
    });
  }

  static async close(user, id) {
    return runWithLogs(log, "close", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getById(pool, id);
      if (!v || v.id_user !== user.id_user) return { error: "Vaquinha não encontrada", statusCode: 404 };
      const updated = await VaquinhaStorage.setStatus(pool, id, "ended");
      // Bolsa encerrada → cancela as assinaturas dos patrocinadores (imediato).
      const live = await VaquinhaStorage.listLiveSponsorships(pool, id);
      for (const s of live) {
        if (s.stripe_subscription_id) {
          try {
            await StripeService.cancelSubscriptionImmediate(s.stripe_subscription_id);
          } catch (err) {
            log.warn("close.cancel_sponsorship_fail", { id_sponsorship: s.id_sponsorship, message: err.message });
          }
        }
        await VaquinhaStorage.markSponsorshipCanceled(pool, s.id_sponsorship);
      }
      return { vaquinha: publicShape(updated) };
    });
  }

  // ─── Público ───────────────────────────────────────────────────────────────
  // user (opcional) resolve o patrocínio do próprio viewer numa bolsa.
  static async getPublic(slug, user = null) {
    return runWithLogs(log, "getPublic", () => ({ slug }), async () => {
      const v = await VaquinhaStorage.getBySlug(pool, slug);
      if (!v || v.status === "canceled") return { error: "Vaquinha não encontrada", statusCode: 404 };
      // Encerramento preguiçoso ao passar do prazo (bolsa não tem prazo).
      if (
        v.status === "active" &&
        v.kind !== "bolsa" &&
        v.deadline &&
        new Date(v.deadline).getTime() < Date.now()
      ) {
        await VaquinhaStorage.setStatus(pool, v.id_vaquinha, "ended");
        v.status = "ended";
      }
      const donors = await VaquinhaStorage.listPaidDonations(pool, v.id_vaquinha, { limit: 30 });
      const settings = await VaquinhaStorage.getSettings(pool);

      let sponsors = [];
      let my_sponsorship = null;
      if (v.kind === "bolsa") {
        const rows = await VaquinhaStorage.listActiveSponsorsPublic(pool, v.id_vaquinha, { limit: 30 });
        sponsors = rows.map((s) => ({
          id_sponsorship: s.id_sponsorship,
          sponsor_name: s.sponsor_name || "Anônimo",
          monthly_cents: Number(s.monthly_cents),
          since: s.activated_at,
        }));
        if (user?.id_user) {
          const mine = await VaquinhaStorage.getLiveSponsorshipForUser(pool, v.id_vaquinha, user.id_user);
          if (mine) {
            my_sponsorship = {
              id_sponsorship: mine.id_sponsorship,
              monthly_cents: Number(mine.monthly_cents),
              status: mine.status,
            };
          }
        }
      }

      return {
        vaquinha: publicShape(v),
        donors: donors.map((d) => ({
          id_donation: d.id_donation,
          donor_name: d.donor_name || "Anônimo",
          message: d.message || null,
          amount_cents: Number(d.gross_cents),
          paid_at: d.paid_at,
        })),
        sponsors,
        my_sponsorship,
        min_donation_cents: Number(settings.min_donation_cents),
      };
    });
  }

  // ─── Doação (Stripe) ──────────────────────────────────────────────────────
  static async donate(user, slug, body = {}) {
    return runWithLogs(log, "donate", () => ({ id_user: user?.id_user, slug }), async () => {
      const v = await VaquinhaStorage.getBySlug(pool, slug);
      if (!v) return { error: "Vaquinha não encontrada", statusCode: 404 };
      if (isExpired(v)) return { error: "Esta vaquinha já foi encerrada", statusCode: 400 };
      if (v.kind === "bolsa") {
        return { error: "Bolsa patrocínio aceita apenas patrocínio mensal.", statusCode: 400 };
      }

      const settings = await VaquinhaStorage.getSettings(pool);
      const gross_cents = Math.round(Number(body.amount_cents));
      if (!Number.isFinite(gross_cents) || gross_cents < Number(settings.min_donation_cents)) {
        return { error: `Doação mínima de R$ ${(settings.min_donation_cents / 100).toFixed(2)}`, statusCode: 400 };
      }
      const feePercent = Number(settings.platform_fee_percent) || 0;
      const platform_fee_cents = Math.round((gross_cents * feePercent) / 100);
      const net_cents = Math.max(0, gross_cents - platform_fee_cents);

      const donor_name = String(body.donor_name || (user ? "" : "Anônimo")).trim().slice(0, 80) || "Anônimo";
      const message = String(body.message || "").trim().slice(0, 280) || null;

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const session = await StripeService.createOneTimeCheckoutSession({
        amount_cents: gross_cents,
        currency: "BRL",
        productName: `Doação — ${v.title}`,
        customerEmail: user?.email || body.email || undefined,
        clientReferenceId: user?.id_user || undefined,
        successUrl: `${frontend}/vaquinha/${v.slug}?doacao=sucesso&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/vaquinha/${v.slug}?doacao=cancelada`,
        metadata: {
          type: "donation",
          id_vaquinha: v.id_vaquinha,
          donor_name,
          gross_cents: String(gross_cents),
        },
      });

      await VaquinhaStorage.createDonation(pool, {
        id_vaquinha: v.id_vaquinha,
        id_donor_user: user?.id_user || null,
        donor_name,
        message,
        gross_cents,
        platform_fee_cents,
        net_cents,
        stripe_session_id: session.id,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  // Webhook: confirma doação paga → credita o Saldo do criador (holdback).
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "donation") return { ignored: true };
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

    let donation = await VaquinhaStorage.getDonationBySession(pool, session.id);
    if (!donation) {
      // Fallback raro (webhook antes do commit do donate): recria da metadata.
      const v = await VaquinhaStorage.getById(pool, meta.id_vaquinha);
      if (!v) return { error: "Vaquinha não encontrada" };
      const settings = await VaquinhaStorage.getSettings(pool);
      const gross = Number(meta.gross_cents) || Number(session.amount_total) || 0;
      if (gross <= 0) return { error: "Valor inválido" };
      const fee = Math.round((gross * (Number(settings.platform_fee_percent) || 0)) / 100);
      donation = await VaquinhaStorage.createDonation(pool, {
        id_vaquinha: v.id_vaquinha,
        id_donor_user: null,
        donor_name: meta.donor_name || "Anônimo",
        gross_cents: gross,
        platform_fee_cents: fee,
        net_cents: Math.max(0, gross - fee),
        stripe_session_id: session.id,
      });
    }

    if (donation.status === "paid") return { ok: true, already: true };

    const paid = await VaquinhaStorage.markDonationPaid(pool, donation.id_donation, {
      paymentIntentId,
      chargeId: null,
    });
    if (!paid) return { ok: true, already: true }; // corrida: outro worker pagou

    const v = await VaquinhaStorage.getById(pool, paid.id_vaquinha);
    await VaquinhaStorage.insertPayout(pool, {
      id_donation: paid.id_donation,
      id_vaquinha: paid.id_vaquinha,
      id_owner_user: v.id_user,
      gross_cents: Number(paid.gross_cents),
      platform_fee_cents: Number(paid.platform_fee_cents),
      net_cents: Number(paid.net_cents),
      available_at: new Date(Date.now() + HOLDBACK_DAYS * DAY_MS),
    });
    await VaquinhaStorage.bumpRaised(pool, paid.id_vaquinha, Number(paid.gross_cents), 1);
    return { ok: true };
  }

  // ─── Bolsa Patrocínio (assinatura mensal, Stripe) ─────────────────────────
  // Cria o checkout recorrente do patrocínio. Exige login (o patrocinador
  // gerencia/cancela pela própria página da bolsa).
  static async sponsor(user, slug, body = {}) {
    return runWithLogs(log, "sponsor", () => ({ id_user: user?.id_user, slug }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getBySlug(pool, slug);
      if (!v) return { error: "Bolsa não encontrada", statusCode: 404 };
      if (v.kind !== "bolsa") return { error: "Esta campanha não aceita patrocínio mensal.", statusCode: 400 };
      if (v.status !== "active") return { error: "Esta bolsa já foi encerrada", statusCode: 400 };
      if (v.id_user === user.id_user) {
        return { error: "Você não pode patrocinar a própria bolsa.", statusCode: 400 };
      }

      const settings = await VaquinhaStorage.getSettings(pool);
      const monthly_cents = Math.round(Number(body.amount_cents));
      if (!Number.isFinite(monthly_cents) || monthly_cents < Number(settings.min_donation_cents)) {
        return {
          error: `Patrocínio mínimo de R$ ${(settings.min_donation_cents / 100).toFixed(2)}/mês`,
          statusCode: 400,
        };
      }

      const live = await VaquinhaStorage.getLiveSponsorshipForUser(pool, v.id_vaquinha, user.id_user);
      if (live && live.status !== "pending") {
        return { error: "Você já patrocina esta bolsa.", statusCode: 409 };
      }

      const sponsor_name = String(body.sponsor_name || "").trim().slice(0, 80) || "Anônimo";
      // Reusa a linha pending (checkout abandonado) ou cria uma nova.
      const row =
        live ||
        (await VaquinhaStorage.createSponsorship(pool, {
          id_vaquinha: v.id_vaquinha,
          id_sponsor_user: user.id_user,
          sponsor_name,
          monthly_cents,
        }));

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const session = await StripeService.createMonthlySubscriptionCheckoutSession({
        amount_cents: Number(row.monthly_cents) || monthly_cents,
        currency: "BRL",
        productName: `Patrocínio mensal — ${v.title}`,
        customerEmail: user?.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/vaquinha/${v.slug}?patrocinio=sucesso&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/vaquinha/${v.slug}?patrocinio=cancelado`,
        metadata: {
          type: "vaquinha_sponsorship",
          id_sponsorship: String(row.id_sponsorship),
          id_vaquinha: String(v.id_vaquinha),
        },
      });

      await VaquinhaStorage.setSponsorshipSession(pool, row.id_sponsorship, session.id);
      return { checkout_url: session.url, session_id: session.id };
    });
  }

  // Patrocinador cancela o próprio patrocínio (imediato; o mês pago não é
  // estornado — é patrocínio, não acesso).
  static async cancelSponsorship(user, slug) {
    return runWithLogs(log, "cancelSponsorship", () => ({ id_user: user?.id_user, slug }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getBySlug(pool, slug);
      if (!v) return { error: "Bolsa não encontrada", statusCode: 404 };
      const live = await VaquinhaStorage.getLiveSponsorshipForUser(pool, v.id_vaquinha, user.id_user);
      if (!live) return { error: "Você não patrocina esta bolsa.", statusCode: 404 };
      if (live.stripe_subscription_id) {
        try {
          await StripeService.cancelSubscriptionImmediate(live.stripe_subscription_id);
        } catch (err) {
          log.warn("cancelSponsorship.stripe_fail", { id_sponsorship: live.id_sponsorship, message: err.message });
        }
      }
      await VaquinhaStorage.markSponsorshipCanceled(pool, live.id_sponsorship);
      return { ok: true };
    });
  }

  // Webhook checkout.session.completed (mode=subscription do patrocínio).
  static async confirmSponsorshipSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "vaquinha_sponsorship") return { ignored: true };
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id || null;

    let row = await VaquinhaStorage.getSponsorshipBySession(pool, session.id);
    if (!row && meta.id_sponsorship) row = await VaquinhaStorage.getSponsorshipById(pool, meta.id_sponsorship);
    if (!row) return { error: "Patrocínio não encontrado" };

    await VaquinhaStorage.activateSponsorship(pool, row.id_sponsorship, {
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
    });
    return { ok: true, already: row.status === "active" };
  }

  // Webhook invoice.paid: cada fatura mensal vira uma "doação" paga (payout com
  // holdback + contador). Idempotente por invoice id. { ignored } se a
  // subscription não é de patrocínio.
  static async handleSponsorshipInvoicePaid(invoice, subscriptionId) {
    const row = await VaquinhaStorage.getSponsorshipBySubscriptionId(pool, subscriptionId);
    if (!row) return { ignored: true };
    return this._recordSponsorInvoice(invoice, subscriptionId, row);
  }

  // Fallback pela metadata da subscription (invoice.paid antes do completed).
  static async handleSponsorshipInvoicePaidByMetadata(invoice, subscription) {
    const meta = subscription?.metadata || {};
    if (meta.type !== "vaquinha_sponsorship" || !meta.id_sponsorship) return { ignored: true };
    const row = await VaquinhaStorage.getSponsorshipById(pool, meta.id_sponsorship);
    if (!row) return { error: "Patrocínio não encontrado" };
    await VaquinhaStorage.activateSponsorship(pool, row.id_sponsorship, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null,
    });
    return this._recordSponsorInvoice(invoice, subscription.id, row);
  }

  static async _recordSponsorInvoice(invoice, subscriptionId, sponsorship) {
    const gross = Number(invoice.amount_paid) || 0;
    if (gross <= 0) return { ok: true, zero: true };

    const v = await VaquinhaStorage.getById(pool, sponsorship.id_vaquinha);
    if (!v) return { error: "Bolsa não encontrada" };

    const settings = await VaquinhaStorage.getSettings(pool);
    const feePercent = Number(settings.platform_fee_percent) || 0;
    const fee = Math.round((gross * feePercent) / 100);

    const paymentIntentId =
      typeof invoice.payment_intent === "string" ? invoice.payment_intent : invoice.payment_intent?.id || null;
    const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id || null;

    const donation = await VaquinhaStorage.createPaidSponsorDonation(pool, {
      id_vaquinha: sponsorship.id_vaquinha,
      id_donor_user: sponsorship.id_sponsor_user,
      donor_name: sponsorship.sponsor_name || "Anônimo",
      gross_cents: gross,
      platform_fee_cents: fee,
      net_cents: Math.max(0, gross - fee),
      id_sponsorship: sponsorship.id_sponsorship,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: chargeId,
    });
    if (!donation) return { ok: true, already: true };

    await VaquinhaStorage.insertPayout(pool, {
      id_donation: donation.id_donation,
      id_vaquinha: donation.id_vaquinha,
      id_owner_user: v.id_user,
      gross_cents: Number(donation.gross_cents),
      platform_fee_cents: Number(donation.platform_fee_cents),
      net_cents: Number(donation.net_cents),
      available_at: new Date(Date.now() + HOLDBACK_DAYS * DAY_MS),
    });
    // Patrocinador conta como apoiador 1x (na primeira fatura); as renovações
    // só somam o valor arrecadado.
    const isFirst = invoice.billing_reason === "subscription_create";
    await VaquinhaStorage.bumpRaised(pool, donation.id_vaquinha, Number(donation.gross_cents), isFirst ? 1 : 0);
    // Renovação em dia → volta a active (pode vir de past_due).
    await VaquinhaStorage.markSponsorshipStatusBySubscriptionId(pool, subscriptionId, "active");
    return { ok: true };
  }

  static async handleSponsorshipInvoiceFailed(subscriptionId) {
    const row = await VaquinhaStorage.getSponsorshipBySubscriptionId(pool, subscriptionId);
    if (!row) return { ignored: true };
    await VaquinhaStorage.markSponsorshipStatusBySubscriptionId(pool, subscriptionId, "past_due");
    return { ok: true };
  }

  static async handleSponsorshipDeleted(subscription) {
    const row = await VaquinhaStorage.getSponsorshipBySubscriptionId(pool, subscription.id);
    if (!row) return { ignored: true };
    await VaquinhaStorage.markSponsorshipCanceled(pool, row.id_sponsorship);
    return { ok: true };
  }

  // Webhook checkout.session.expired do patrocínio (nunca pago).
  static async expireSponsorshipBySession(sessionId) {
    return VaquinhaStorage.markSponsorshipExpiredBySession(pool, sessionId);
  }

  // Webhook charge.refunded: reverte a doação e o Saldo (não-owner de outra charge → null).
  static async handleChargeRefunded(charge) {
    return runWithLogs(log, "handleChargeRefunded", () => ({ charge: charge?.id }), async () => {
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
      const donation = await VaquinhaStorage.getPaidDonationByCharge(pool, {
        chargeId: charge.id,
        paymentIntentId,
      });
      if (!donation) return null; // não é uma doação nossa
      await VaquinhaStorage.markDonationRefunded(pool, donation.id_donation);
      await VaquinhaStorage.revertPayoutByDonation(pool, donation.id_donation);
      // Fatura de patrocínio estornada só reverte o valor (o patrocinador
      // contou como apoiador 1x na primeira fatura, não por ciclo).
      const donorDelta = donation.id_sponsorship ? 0 : -1;
      await VaquinhaStorage.bumpRaised(pool, donation.id_vaquinha, -Number(donation.gross_cents), donorDelta);
      return { reverted: true };
    });
  }

  // ─── Posts (só na página da vaquinha) ─────────────────────────────────────
  static async createPost(user, id, body = {}, file = null) {
    return runWithLogs(log, "createPost", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getById(pool, id);
      if (!v || v.id_user !== user.id_user) return { error: "Vaquinha não encontrada", statusCode: 404 };
      const kind = ["post", "bee", "text"].includes(body.kind) ? body.kind : "post";
      const caption = String(body.caption || "").slice(0, 3000);
      if (kind === "text" && !caption.trim()) return { error: "Escreva algo", statusCode: 400 };
      if (kind !== "text" && !file?.buffer) return { error: "Mídia obrigatória", statusCode: 400 };

      let media_url = null;
      let thumbnail_url = null;
      let media_type = null;
      if (kind !== "text" && file?.buffer) {
        const mimetype = String(file.mimetype || "").toLowerCase();
        media_type = mimetype.startsWith("image/") ? "image" : mimetype.startsWith("video/") ? "video" : null;
        if (!media_type) return { error: "Tipo de arquivo não permitido", statusCode: 400 };
        // bee = vídeo vertical (preserva aspecto); post = imagem 4:5 / vídeo 4:5.
        const processed = await processPortfolioMedia(file, media_type, {
          feedKind: kind === "bee" ? "bees" : "feed",
        });
        const r2 = await uploadVaquinhaMediaToR2({ id_vaquinha: id, file: processed });
        media_url = r2.url;
        thumbnail_url = r2.thumbnail_url;
      }

      const post = await VaquinhaStorage.createPost(pool, {
        id_vaquinha: id,
        id_user: user.id_user,
        kind,
        caption,
        media_url,
        thumbnail_url,
        media_type,
      });
      return { post };
    });
  }

  static async listPosts(slug, query = {}) {
    return runWithLogs(log, "listPosts", () => ({ slug }), async () => {
      const v = await VaquinhaStorage.getBySlug(pool, slug);
      if (!v) return { error: "Vaquinha não encontrada", statusCode: 404 };
      const posts = await VaquinhaStorage.listPosts(pool, v.id_vaquinha, {
        kind: query.kind,
        limit: Number(query.limit) || 30,
        offset: Number(query.offset) || 0,
      });
      return { posts };
    });
  }

  static async deletePost(user, postId) {
    return runWithLogs(log, "deletePost", () => ({ id_user: user?.id_user, postId }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const post = await VaquinhaStorage.getPost(pool, postId);
      if (!post || post.id_user !== user.id_user) return { error: "Post não encontrado", statusCode: 404 };
      await VaquinhaStorage.softDeletePost(pool, postId);
      return { ok: true };
    });
  }

  // ─── Admin (taxa) ─────────────────────────────────────────────────────────
  static async getSettings() {
    return runWithLogs(log, "getSettings", () => ({}), async () => {
      const s = await VaquinhaStorage.getSettings(pool);
      return { settings: s };
    });
  }

  static async updateSettings(user, body = {}) {
    return runWithLogs(log, "updateSettings", () => ({ id_user: user?.id_user }), async () => {
      const patch = { updated_by: user?.id_user };
      if (body.platform_fee_percent !== undefined) {
        const p = Number(body.platform_fee_percent);
        if (!Number.isFinite(p) || p < 0 || p > 100) return { error: "Taxa inválida (0–100)", statusCode: 400 };
        patch.platform_fee_percent = p;
      }
      if (body.max_days !== undefined) {
        const d = Math.round(Number(body.max_days));
        if (!Number.isFinite(d) || d <= 0 || d > 365) return { error: "max_days inválido", statusCode: 400 };
        patch.max_days = d;
      }
      if (body.min_donation_cents !== undefined) {
        const m = Math.round(Number(body.min_donation_cents));
        if (!Number.isFinite(m) || m <= 0) return { error: "min_donation_cents inválido", statusCode: 400 };
        patch.min_donation_cents = m;
      }
      const s = await VaquinhaStorage.updateSettings(pool, patch);
      return { settings: s };
    });
  }
}

module.exports = VaquinhaService;
