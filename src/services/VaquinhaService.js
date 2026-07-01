// src/services/VaquinhaService.js
// Vaquinha (campanha de doação). Doações via Stripe caem no Saldo do criador
// (holdback 8 dias, espelha BookingPayout) menos a taxa da plataforma.
const pool = require("../databases");
const VaquinhaStorage = require("../storages/VaquinhaStorage");
const StripeService = require("./StripeService");
const { processPortfolioMedia } = require("../utils/mediaJobs");
const uploadVaquinhaMediaToR2 = require("../integrations/r2/uploadVaquinhaMedia");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("VaquinhaService");
const HOLDBACK_DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function isExpired(v) {
  return v.status !== "active" || new Date(v.deadline).getTime() < Date.now();
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

      const deadlineMs = new Date(body.deadline).getTime();
      if (!Number.isFinite(deadlineMs)) return { error: "Prazo inválido", statusCode: 400 };
      const maxMs = Date.now() + Number(settings.max_days) * DAY_MS;
      if (deadlineMs <= Date.now()) return { error: "O prazo precisa ser no futuro", statusCode: 400 };
      if (deadlineMs > maxMs + DAY_MS) {
        return { error: `O prazo máximo é de ${settings.max_days} dias`, statusCode: 400 };
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
        deadline: new Date(deadlineMs),
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
      const updated = await VaquinhaStorage.update(pool, id, fields);
      return { vaquinha: publicShape(updated) };
    });
  }

  static async close(user, id) {
    return runWithLogs(log, "close", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const v = await VaquinhaStorage.getById(pool, id);
      if (!v || v.id_user !== user.id_user) return { error: "Vaquinha não encontrada", statusCode: 404 };
      const updated = await VaquinhaStorage.setStatus(pool, id, "ended");
      return { vaquinha: publicShape(updated) };
    });
  }

  // ─── Público ───────────────────────────────────────────────────────────────
  static async getPublic(slug) {
    return runWithLogs(log, "getPublic", () => ({ slug }), async () => {
      const v = await VaquinhaStorage.getBySlug(pool, slug);
      if (!v || v.status === "canceled") return { error: "Vaquinha não encontrada", statusCode: 404 };
      // Encerramento preguiçoso ao passar do prazo.
      if (v.status === "active" && new Date(v.deadline).getTime() < Date.now()) {
        await VaquinhaStorage.setStatus(pool, v.id_vaquinha, "ended");
        v.status = "ended";
      }
      const donors = await VaquinhaStorage.listPaidDonations(pool, v.id_vaquinha, { limit: 30 });
      const settings = await VaquinhaStorage.getSettings(pool);
      return {
        vaquinha: publicShape(v),
        donors: donors.map((d) => ({
          id_donation: d.id_donation,
          donor_name: d.donor_name || "Anônimo",
          message: d.message || null,
          amount_cents: Number(d.gross_cents),
          paid_at: d.paid_at,
        })),
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
      await VaquinhaStorage.bumpRaised(pool, donation.id_vaquinha, -Number(donation.gross_cents), -1);
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
