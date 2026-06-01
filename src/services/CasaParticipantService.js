const pool = require("../databases");
const CasaParticipantStorage = require("../storages/CasaParticipantStorage");
const CasaProductStorage = require("../storages/CasaProductStorage");
const CasaStoreStorage = require("../storages/CasaStoreStorage");
const StripeService = require("./StripeService");
const uploadCasaParticipantMediaToR2 = require("../integrations/r2/uploadCasaParticipantMedia");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CasaParticipantService");

const ACCENTS = new Set(["cyan", "magenta", "gold"]);
const STATUSES = new Set(["active", "eliminated", "finalist", "winner"]);
const SENTIMENTS = new Set(["positive", "neutral", "negative"]);
const SHOW_FLAGS = [
  "show_perfil", "show_journey", "show_secrets", "show_theories", "show_desempenho",
  "show_cofre", "show_suspicion", "show_captures", "show_store",
];

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function txt(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function boolish(v, fallback) {
  if (v === undefined) return fallback;
  return v === true || v === "true" || v === "1" || v === 1;
}

class CasaParticipantService {
  // ──────────────────────── Público ────────────────────────

  // Lista os participantes ativos (editorial). Os números ao vivo
  // (views/likes/comentários/pontos/posição) são mesclados no server component
  // do Next via o proxy /api/acasaviews/rankings (helper ranking-live.ts).
  static async listPublic() {
    return runWithLogs(log, "listPublic", () => ({}), async () => {
      const participants = await CasaParticipantStorage.listParticipants(pool, { onlyActive: true });
      return { participants };
    });
  }

  static async getPublicBySlug(slug) {
    return runWithLogs(log, "getPublicBySlug", () => ({ slug }), async () => {
      const participant = await CasaParticipantStorage.getParticipantBySlug(pool, slug);
      if (!participant || !participant.is_active) return { error: "Participante não encontrado" };
      // Conveniência Views é uma loja ÚNICA global: toda página de participante
      // ESPELHA a mesma vitrine. A atribuição da venda ao participante acontece
      // no checkout (id_participant no pedido), não no produto.
      const [journey, secrets, theories, products] = await Promise.all([
        CasaParticipantStorage.listJourney(pool, participant.id),
        CasaParticipantStorage.listSecrets(pool, participant.id),
        CasaParticipantStorage.listTheories(pool, participant.id),
        CasaStoreStorage.listProductsWithMedia(pool, { onlyActive: true }),
      ]);
      return { participant, journey, secrets, theories, products };
    });
  }

  // ──────────────────────── Checkout (Conveniência Views) ────────────────────────

  static async createProductCheckout(user, body = {}) {
    return runWithLogs(log, "createProductCheckout", () => ({ id_user: user?.id_user, product_id: body?.product_id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const product = await CasaStoreStorage.getProductById(pool, body.product_id);
      if (!product || !product.is_active) return { error: "Produto não encontrado" };
      const amount = Number(product.price_cents) || 0;
      if (amount <= 0) return { error: "Produto sem preço" };
      if (product.stock !== null && Number(product.stock) <= 0) return { error: "Produto esgotado" };

      // Atribuição: o participante vem da PÁGINA onde a compra aconteceu.
      const participant = body.participant_slug
        ? await CasaParticipantStorage.getParticipantBySlug(pool, body.participant_slug)
        : body.participant_id
          ? await CasaParticipantStorage.getParticipantById(pool, body.participant_id)
          : null;
      if (!participant) return { error: "Participante (atribuição) não informado" };

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const successUrl = `${frontend}/acasaviews/participantes/${participant.slug}?compra=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${frontend}/acasaviews/participantes/${participant.slug}?compra=cancel`;

      const session = await StripeService.createMultiItemCheckoutSession({
        line_items: [{ name: `Conveniência Views — ${product.name}`, amount_cents: amount, quantity: 1 }],
        currency: "BRL",
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl,
        cancelUrl,
        metadata: {
          type: "casa_participant_order",
          user_id: user.id_user,
          product_id: product.id,
          participant_id: participant.id,
        },
      });

      // Registra o pedido pendente já com o session_id (idempotência via UNIQUE).
      await CasaProductStorage.createOrder(pool, {
        id_product: product.id,
        id_participant: participant.id,
        id_user: user.id_user,
        buyer_email: user.email || null,
        product_name: product.name,
        quantity: 1,
        amount_cents: amount,
        stripe_session_id: session.id,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  // Confirma a sessão paga (chamado pelo StripeWebhookService). Idempotente.
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "casa_participant_order") return { ignored: true };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await CasaProductStorage.getOrderByStripeSession(client, session.id);
      if (existing && existing.status === "paid") {
        await client.query("COMMIT");
        return { order: existing, duplicate: true };
      }

      const product = await CasaStoreStorage.getProductById(client, meta.product_id);
      if (!product) {
        await client.query("ROLLBACK");
        return { error: "Produto não encontrado" };
      }

      // Garante a linha do pedido caso o create no checkout tenha falhado.
      // O participante (atribuição) vem do metadata da sessão.
      if (!existing && meta.participant_id) {
        await CasaProductStorage.createOrder(client, {
          id_product: product.id,
          id_participant: meta.participant_id,
          id_user: meta.user_id || null,
          buyer_email: null,
          product_name: product.name,
          quantity: 1,
          amount_cents: session.amount_total ?? product.price_cents,
          stripe_session_id: session.id,
        });
      }

      // Reserva estoque (NULL = ilimitado).
      const reserved = await CasaStoreStorage.reserveStock(client, product.id);
      if (!reserved) {
        // sem estoque: cancela o pedido, mas não derruba o webhook
        await CasaProductStorage.markOrderCanceled(client, session.id);
        await client.query("COMMIT");
        return { error: "Produto esgotado no momento da confirmação", order_canceled: true };
      }

      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;
      let chargeId = null;
      if (paymentIntent) {
        try {
          const pi = await StripeService.retrievePaymentIntent(paymentIntent, { expand: ["latest_charge"] });
          chargeId = typeof pi.latest_charge === "object" ? pi.latest_charge?.id : pi.latest_charge || null;
        } catch (err) {
          log.warn("confirm.pi_lookup_fail", { paymentIntent, message: err.message });
        }
      }

      const order = await CasaProductStorage.markOrderPaid(client, session.id, {
        stripe_payment_intent: paymentIntent,
        stripe_charge_id: chargeId,
      });
      await client.query("COMMIT");
      return { order };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Reembolso manual via Stripe (charge.refunded). Devolve estoque.
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    const order =
      (await CasaProductStorage.getOrderByChargeId(pool, charge.id)) ||
      (paymentIntentId ? await CasaProductStorage.getOrderByPaymentIntent(pool, paymentIntentId) : null);
    if (!order) return { ignored: true };
    if (order.status === "refunded") return { order, duplicate: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await CasaStoreStorage.restoreStock(client, order.id_product);
      const updated = await CasaProductStorage.markOrderRefunded(client, order.id);
      await client.query("COMMIT");
      return { order: updated };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async listMyOrders(user, query = {}) {
    return runWithLogs(log, "listMyOrders", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const limit = clampInt(query.limit, { min: 1, max: 100, fallback: 50 });
      const offset = clampInt(query.offset, { fallback: 0 });
      const orders = await CasaProductStorage.listOrdersForUser(pool, user.id_user, { limit, offset });
      return { orders };
    });
  }

  // ──────────────────────── Admin: participantes ────────────────────────

  static async adminList() {
    return { participants: await CasaParticipantStorage.listParticipants(pool) };
  }

  static async adminGet(id) {
    return runWithLogs(log, "adminGet", () => ({ id }), async () => {
      const participant = await CasaParticipantStorage.getParticipantById(pool, id);
      if (!participant) return { error: "Participante não encontrado" };
      const [journey, secrets, theories] = await Promise.all([
        CasaParticipantStorage.listJourney(pool, id),
        CasaParticipantStorage.listSecrets(pool, id),
        CasaParticipantStorage.listTheories(pool, id),
      ]);
      return { participant, journey, secrets, theories };
    });
  }

  static async adminCreate(body, file) {
    return runWithLogs(log, "adminCreate", () => ({ name: body?.display_name }), async () => {
      const display_name = txt(body?.display_name, 120);
      if (!display_name) return { error: "display_name obrigatório" };
      let slug = txt(body?.slug, 80) || slugify(display_name);
      if (!slug) return { error: "slug inválido" };
      const dup = await CasaParticipantStorage.getParticipantBySlug(pool, slug);
      if (dup) return { error: "Slug já cadastrado" };

      let avatar_url = txt(body?.avatar_url, 600);
      let cover_url = txt(body?.cover_url, 600);
      if (file?.buffer) {
        const kind = body?.upload_kind === "cover" ? "cover" : "avatar";
        const url = await uploadCasaParticipantMediaToR2({ file, kind });
        if (kind === "cover") cover_url = url; else avatar_url = url;
      }

      const accent_color = txt(body?.accent_color, 20) || "magenta";
      if (!ACCENTS.has(accent_color)) return { error: "accent_color inválido" };
      const status = txt(body?.status, 24) || "active";
      if (!STATUSES.has(status)) return { error: "status inválido" };

      const participant = await CasaParticipantStorage.createParticipant(pool, {
        slug,
        display_name,
        tagline: txt(body?.tagline, 220),
        avatar_url,
        cover_url,
        bio: txt(body?.bio, 5000),
        quote: txt(body?.quote, 1000),
        vault_amount_cents: clampInt(body?.vault_amount_cents, { fallback: 0 }),
        suspicion_pct: clampInt(body?.suspicion_pct, { min: 0, max: 100, fallback: 0 }),
        captures_count: clampInt(body?.captures_count, { fallback: 0 }),
        status,
        accent_color,
        external_ranking_user_id: txt(body?.external_ranking_user_id, 160),
        is_active: boolish(body?.is_active, true),
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      });
      return { participant };
    });
  }

  static async adminUpdate(id, body, file) {
    return runWithLogs(log, "adminUpdate", () => ({ id }), async () => {
      const existing = await CasaParticipantStorage.getParticipantById(pool, id);
      if (!existing) return { error: "Participante não encontrado" };

      const patch = {};
      if (body?.display_name !== undefined) {
        const v = txt(body.display_name, 120);
        if (!v) return { error: "display_name inválido" };
        patch.display_name = v;
      }
      if (body?.slug !== undefined) {
        const v = txt(body.slug, 80);
        if (!v) return { error: "slug inválido" };
        if (v !== existing.slug) {
          const dup = await CasaParticipantStorage.getParticipantBySlug(pool, v);
          if (dup) return { error: "Slug já cadastrado" };
        }
        patch.slug = v;
      }
      if (body?.tagline !== undefined) patch.tagline = txt(body.tagline, 220);
      if (body?.bio !== undefined) patch.bio = txt(body.bio, 5000);
      if (body?.quote !== undefined) patch.quote = txt(body.quote, 1000);
      if (body?.vault_amount_cents !== undefined) patch.vault_amount_cents = clampInt(body.vault_amount_cents);
      if (body?.suspicion_pct !== undefined) patch.suspicion_pct = clampInt(body.suspicion_pct, { min: 0, max: 100 });
      if (body?.captures_count !== undefined) patch.captures_count = clampInt(body.captures_count);
      if (body?.accent_color !== undefined) {
        const v = txt(body.accent_color, 20);
        if (!v || !ACCENTS.has(v)) return { error: "accent_color inválido" };
        patch.accent_color = v;
      }
      if (body?.status !== undefined) {
        const v = txt(body.status, 24);
        if (!v || !STATUSES.has(v)) return { error: "status inválido" };
        patch.status = v;
      }
      if (body?.external_ranking_user_id !== undefined) patch.external_ranking_user_id = txt(body.external_ranking_user_id, 160);
      if (body?.is_active !== undefined) patch.is_active = boolish(body.is_active, true);
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      for (const k of SHOW_FLAGS) if (body?.[k] !== undefined) patch[k] = boolish(body[k], true);

      if (file?.buffer) {
        const kind = body?.upload_kind === "cover" ? "cover" : "avatar";
        const url = await uploadCasaParticipantMediaToR2({ file, kind });
        if (kind === "cover") patch.cover_url = url; else patch.avatar_url = url;
      } else {
        if (body?.avatar_url !== undefined) patch.avatar_url = txt(body.avatar_url, 600);
        if (body?.cover_url !== undefined) patch.cover_url = txt(body.cover_url, 600);
      }

      const participant = await CasaParticipantStorage.updateParticipant(pool, id, patch);
      return { participant };
    });
  }

  // Salva TUDO de uma vez (editor inline): campos do participante + flags de
  // visibilidade + substitui jornada/segredos/teorias. Uma transação só.
  static async adminSaveFull(id, body = {}) {
    return runWithLogs(log, "adminSaveFull", () => ({ id }), async () => {
      const existing = await CasaParticipantStorage.getParticipantById(pool, id);
      if (!existing) return { error: "Participante não encontrado" };
      const pb = body.participant || {};

      const patch = {};
      if (pb.display_name !== undefined) { const v = txt(pb.display_name, 120); if (!v) return { error: "Nome obrigatório" }; patch.display_name = v; }
      if (pb.slug !== undefined) {
        const v = txt(pb.slug, 80) || slugify(pb.display_name || existing.display_name);
        if (v && v !== existing.slug) {
          const dup = await CasaParticipantStorage.getParticipantBySlug(pool, v);
          if (dup) return { error: "Slug já cadastrado" };
        }
        patch.slug = v;
      }
      if (pb.tagline !== undefined) patch.tagline = txt(pb.tagline, 220);
      if (pb.bio !== undefined) patch.bio = txt(pb.bio, 5000);
      if (pb.quote !== undefined) patch.quote = txt(pb.quote, 1000);
      if (pb.vault_amount_cents !== undefined) patch.vault_amount_cents = clampInt(pb.vault_amount_cents);
      if (pb.suspicion_pct !== undefined) patch.suspicion_pct = clampInt(pb.suspicion_pct, { min: 0, max: 100 });
      if (pb.captures_count !== undefined) patch.captures_count = clampInt(pb.captures_count);
      if (pb.accent_color !== undefined) { const v = txt(pb.accent_color, 20); if (!v || !ACCENTS.has(v)) return { error: "Cor inválida" }; patch.accent_color = v; }
      if (pb.status !== undefined) { const v = txt(pb.status, 24); if (!v || !STATUSES.has(v)) return { error: "Status inválido" }; patch.status = v; }
      if (pb.external_ranking_user_id !== undefined) patch.external_ranking_user_id = txt(pb.external_ranking_user_id, 160);
      if (pb.is_active !== undefined) patch.is_active = boolish(pb.is_active, true);
      if (pb.avatar_url !== undefined) patch.avatar_url = txt(pb.avatar_url, 600);
      if (pb.cover_url !== undefined) patch.cover_url = txt(pb.cover_url, 600);
      for (const k of SHOW_FLAGS) if (pb[k] !== undefined) patch[k] = boolish(pb[k], true);

      const journey = Array.isArray(body.journey) ? body.journey
        .map((j) => ({ label: txt(j.label, 120), title: txt(j.title, 180), description: txt(j.description, 2000), sentiment: SENTIMENTS.has(j.sentiment) ? j.sentiment : "neutral" }))
        .filter((j) => j.title) : null;
      const secrets = Array.isArray(body.secrets) ? body.secrets
        .map((s) => ({ content: txt(s.content, 2000), author_label: txt(s.author_label, 120) || "anônimo", revealed: boolish(s.revealed, true) }))
        .filter((s) => s.content) : null;
      const theories = Array.isArray(body.theories) ? body.theories
        .map((t) => ({ content: txt(t.content, 2000), author_label: txt(t.author_label, 120) || "audiência", votes: clampInt(t.votes, { fallback: 0 }) }))
        .filter((t) => t.content) : null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await CasaParticipantStorage.updateParticipant(client, id, patch);
        if (journey) await CasaParticipantStorage.replaceJourney(client, id, journey);
        if (secrets) await CasaParticipantStorage.replaceSecrets(client, id, secrets);
        if (theories) await CasaParticipantStorage.replaceTheories(client, id, theories);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return this.adminGet(id);
    });
  }

  static async adminDelete(id) {
    return runWithLogs(log, "adminDelete", () => ({ id }), async () => {
      const existing = await CasaParticipantStorage.getParticipantById(pool, id);
      if (!existing) return { error: "Participante não encontrado" };
      await CasaParticipantStorage.deleteParticipant(pool, id);
      return { ok: true };
    });
  }

  static async adminUpload(file, kind = "avatar") {
    return runWithLogs(log, "adminUpload", () => ({ kind }), async () => {
      if (!file?.buffer) return { error: "Arquivo obrigatório" };
      const k = ["avatar", "cover", "product"].includes(kind) ? kind : "media";
      const url = await uploadCasaParticipantMediaToR2({ file, kind: k });
      return { url };
    });
  }

  // ──────────────────────── Admin: blocos editoriais ────────────────────────

  static async adminCreateJourney(id_participant, body) {
    return runWithLogs(log, "adminCreateJourney", () => ({ id_participant }), async () => {
      const p = await CasaParticipantStorage.getParticipantById(pool, id_participant);
      if (!p) return { error: "Participante não encontrado" };
      const title = txt(body?.title, 180);
      if (!title) return { error: "title obrigatório" };
      const sentiment = txt(body?.sentiment, 20) || "neutral";
      if (!SENTIMENTS.has(sentiment)) return { error: "sentiment inválido" };
      const item = await CasaParticipantStorage.createJourney(pool, {
        id_participant,
        label: txt(body?.label, 120),
        title,
        description: txt(body?.description, 2000),
        happened_on: body?.happened_on || null,
        sentiment,
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      });
      return { item };
    });
  }

  static async adminUpdateJourney(id, body) {
    return runWithLogs(log, "adminUpdateJourney", () => ({ id }), async () => {
      const patch = {};
      if (body?.label !== undefined) patch.label = txt(body.label, 120);
      if (body?.title !== undefined) { const v = txt(body.title, 180); if (!v) return { error: "title inválido" }; patch.title = v; }
      if (body?.description !== undefined) patch.description = txt(body.description, 2000);
      if (body?.happened_on !== undefined) patch.happened_on = body.happened_on || null;
      if (body?.sentiment !== undefined) { const v = txt(body.sentiment, 20); if (!v || !SENTIMENTS.has(v)) return { error: "sentiment inválido" }; patch.sentiment = v; }
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      const item = await CasaParticipantStorage.updateJourney(pool, id, patch);
      if (!item) return { error: "Item não encontrado" };
      return { item };
    });
  }

  static async adminDeleteJourney(id) {
    await CasaParticipantStorage.deleteJourney(pool, id);
    return { ok: true };
  }

  static async adminCreateSecret(id_participant, body) {
    return runWithLogs(log, "adminCreateSecret", () => ({ id_participant }), async () => {
      const p = await CasaParticipantStorage.getParticipantById(pool, id_participant);
      if (!p) return { error: "Participante não encontrado" };
      const content = txt(body?.content, 2000);
      if (!content) return { error: "content obrigatório" };
      const item = await CasaParticipantStorage.createSecret(pool, {
        id_participant,
        content,
        author_label: txt(body?.author_label, 120) || "anônimo",
        revealed: boolish(body?.revealed, true),
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      });
      return { item };
    });
  }

  static async adminUpdateSecret(id, body) {
    return runWithLogs(log, "adminUpdateSecret", () => ({ id }), async () => {
      const patch = {};
      if (body?.content !== undefined) { const v = txt(body.content, 2000); if (!v) return { error: "content inválido" }; patch.content = v; }
      if (body?.author_label !== undefined) patch.author_label = txt(body.author_label, 120) || "anônimo";
      if (body?.revealed !== undefined) patch.revealed = boolish(body.revealed, true);
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      const item = await CasaParticipantStorage.updateSecret(pool, id, patch);
      if (!item) return { error: "Item não encontrado" };
      return { item };
    });
  }

  static async adminDeleteSecret(id) {
    await CasaParticipantStorage.deleteSecret(pool, id);
    return { ok: true };
  }

  static async adminCreateTheory(id_participant, body) {
    return runWithLogs(log, "adminCreateTheory", () => ({ id_participant }), async () => {
      const p = await CasaParticipantStorage.getParticipantById(pool, id_participant);
      if (!p) return { error: "Participante não encontrado" };
      const content = txt(body?.content, 2000);
      if (!content) return { error: "content obrigatório" };
      const item = await CasaParticipantStorage.createTheory(pool, {
        id_participant,
        content,
        author_label: txt(body?.author_label, 120) || "audiência",
        votes: clampInt(body?.votes, { fallback: 0 }),
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      });
      return { item };
    });
  }

  static async adminUpdateTheory(id, body) {
    return runWithLogs(log, "adminUpdateTheory", () => ({ id }), async () => {
      const patch = {};
      if (body?.content !== undefined) { const v = txt(body.content, 2000); if (!v) return { error: "content inválido" }; patch.content = v; }
      if (body?.author_label !== undefined) patch.author_label = txt(body.author_label, 120) || "audiência";
      if (body?.votes !== undefined) patch.votes = clampInt(body.votes);
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      const item = await CasaParticipantStorage.updateTheory(pool, id, patch);
      if (!item) return { error: "Item não encontrado" };
      return { item };
    });
  }

  static async adminDeleteTheory(id) {
    await CasaParticipantStorage.deleteTheory(pool, id);
    return { ok: true };
  }
  // Produtos da Conveniência Views são GLOBAIS — geridos por CasaStoreService.
}

module.exports = CasaParticipantService;
