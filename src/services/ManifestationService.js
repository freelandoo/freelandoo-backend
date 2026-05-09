const crypto = require("crypto");
const pool = require("../databases");
const ManifestationStorage = require("../storages/ManifestationStorage");
const PolenStorage = require("../storages/PolenStorage");
const StripeService = require("./StripeService");
const uploadManifestationBannerToR2 = require("../integrations/r2/uploadManifestationBanner");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ManifestationService");

const ALLOWED_TAG_COLORS = new Set([
  "emerald", "amber", "rose", "sky", "violet", "zinc", "primary", "white", "red", "blue", "green", "yellow", "orange",
]);

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function csvCell(value) {
  if (value == null) return "";
  const s = Array.isArray(value) ? value.join("; ") : String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const header = [
    "username",
    "display_name",
    "email",
    "payment_method",
    "amount_cents",
    "amount_polens",
    "acquired_at",
    "expires_at",
    "is_active",
    "subprofiles_applied",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const subprofiles = Array.isArray(row.subprofiles_applied)
      ? row.subprofiles_applied.map((p) => p.display_name || p.id_profile).filter(Boolean)
      : [];
    lines.push([
      row.username,
      row.display_name,
      row.email,
      row.payment_method,
      row.amount_cents,
      row.amount_polens,
      row.acquired_at ? new Date(row.acquired_at).toISOString() : "",
      row.expires_at ? new Date(row.expires_at).toISOString() : "",
      row.is_active,
      subprofiles,
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function checkManifestationEligibility(conn, userId) {
  const settings = await PolenStorage.getSettings(conn);
  const eligibility = await PolenStorage.getUserManifestationEligibility(conn, userId);
  const isAdmin = !!eligibility.is_admin;
  const maxLevel = Number(eligibility.max_xp_level) || 0;
  const minLevel = Number(settings?.manifestation_min_xp_level) || 0;
  const adminEnabled = settings?.manifestation_admin_enabled !== false;
  const usersEnabled = settings?.manifestation_users_enabled !== false;

  if (isAdmin && adminEnabled) {
    return { ok: true, settings, eligibility: { ...eligibility, max_xp_level: maxLevel } };
  }
  if (!usersEnabled) {
    return {
      ok: false,
      settings,
      eligibility: { ...eligibility, max_xp_level: maxLevel },
      error: "Manifestação indisponível para usuários no momento",
    };
  }
  if (maxLevel < minLevel) {
    return {
      ok: false,
      settings,
      eligibility: { ...eligibility, max_xp_level: maxLevel },
      error: `Manifestação disponível para usuários nível ${minLevel}+`,
    };
  }
  return { ok: true, settings, eligibility: { ...eligibility, max_xp_level: maxLevel } };
}

class ManifestationService {
  // ---------- Public listing (Slice 4 will consume this) ----------

  static async listPublicCatalog() {
    return runWithLogs(log, "listPublicCatalog", () => ({}), async () => {
      const [categories, products, featured] = await Promise.all([
        ManifestationStorage.listCategories(pool, { onlyActive: true }),
        ManifestationStorage.listProducts(pool, { onlyActive: true }),
        ManifestationStorage.getFeaturedProduct(pool),
      ]);
      return { categories, products, featured };
    });
  }

  static async getPublicProduct(id) {
    return runWithLogs(log, "getPublicProduct", () => ({ id }), async () => {
      if (!id) return { error: "id obrigatório" };
      const product = await ManifestationStorage.getProductById(pool, id);
      if (!product || !product.is_active) return { error: "Produto não encontrado" };
      return { product };
    });
  }

  static async getMine(user, query = {}) {
    return runWithLogs(log, "getMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "NÃ£o autenticado" };
      const [active, profiles, history] = await Promise.all([
        ManifestationStorage.getActiveForUser(pool, user.id_user),
        ManifestationStorage.listOwnedProfilesForApply(pool, user.id_user),
        ManifestationStorage.listHistoryForUser(pool, user.id_user, {
          limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100),
          offset: Math.max(Number(query.offset) || 0, 0),
        }),
      ]);
      const applied = active?.id ? await ManifestationStorage.listAppliedProfileIds(pool, active.id) : [];
      return { active, applied_profile_ids: applied, profiles, history };
    });
  }

  static async checkoutWithPolens(user, body = {}) {
    return runWithLogs(log, "checkoutWithPolens", () => ({ id_user: user?.id_user, product_id: body?.product_id }), async () => {
      if (!user?.id_user) return { error: "NÃ£o autenticado" };
      const product = await ManifestationStorage.getProductById(pool, body.product_id);
      if (!product || !product.is_active) return { error: "Produto nÃ£o encontrado" };
      const amount = Number(product.price_polens) || 0;
      if (amount <= 0) return { error: "Produto sem preÃ§o em PolÃ©ns" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const gate = await checkManifestationEligibility(client, user.id_user);
        const settings = gate.settings;
        if (!settings?.is_active) {
          await client.query("ROLLBACK");
          return { error: "Sistema de PolÃ©ns inativo" };
        }
        if (!gate.ok) {
          await client.query("ROLLBACK");
          return { error: gate.error, eligibility: gate.eligibility };
        }
        const reserved = await ManifestationStorage.reserveStock(client, product.id);
        if (!reserved) {
          await client.query("ROLLBACK");
          return { error: "Produto indisponÃ­vel" };
        }
        const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);
        const sourceId = `manifestation:${product.id}:${crypto.randomUUID()}`;
        const debit = await PolenStorage.debit(client, {
          user_id: user.id_user,
          wallet_id: wallet.id,
          amount,
          type: "spend_manifestation",
          source: "manifestation",
          source_id: sourceId,
          metadata: { product_id: product.id, product_name: product.name },
        });
        if (!debit) {
          await client.query("ROLLBACK");
          return { error: "Saldo insuficiente" };
        }
        await ManifestationStorage.deactivateActiveForUser(client, user.id_user);
        const manifestation = await ManifestationStorage.createUserManifestation(client, {
          user_id: user.id_user,
          product_id: product.id,
          duration_days: product.duration_days,
          payment_method: "polens",
          amount_polens: amount,
        });
        await client.query("COMMIT");
        return { manifestation, wallet: debit.wallet, transaction: debit.transaction };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async createStripeCheckout(user, body = {}) {
    return runWithLogs(log, "createStripeCheckout", () => ({ id_user: user?.id_user, product_id: body?.product_id }), async () => {
      if (!user?.id_user) return { error: "NÃ£o autenticado" };
      const product = await ManifestationStorage.getProductById(pool, body.product_id);
      if (!product || !product.is_active) return { error: "Produto nÃ£o encontrado" };
      const amount = Number(product.price_cents) || 0;
      if (amount <= 0) return { error: "Produto sem preÃ§o em reais" };
      if (product.stock !== null && Number(product.stock) <= 0) return { error: "Produto indisponÃ­vel" };

      const gate = await checkManifestationEligibility(pool, user.id_user);
      if (!gate.ok) return { error: gate.error, eligibility: gate.eligibility };

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const session = await StripeService.createOneTimeCheckoutSession({
        amount_cents: amount,
        currency: "BRL",
        productName: `Manifestação - ${product.name}`,
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/manifestacao?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/manifestacao/${product.id}?checkout=cancel`,
        metadata: {
          type: "manifestation",
          user_id: user.id_user,
          product_id: product.id,
        },
      });
      return { checkout_url: session.url, session_id: session.id };
    });
  }

  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "manifestation") return { ignored: true };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await ManifestationStorage.getUserManifestationByStripeSession(client, session.id);
      if (existing) {
        await client.query("COMMIT");
        return { manifestation: existing, duplicate: true };
      }
      const product = await ManifestationStorage.getProductById(client, meta.product_id);
      if (!product || !product.is_active) {
        await client.query("ROLLBACK");
        return { error: "Produto nÃ£o encontrado" };
      }
      const reserved = await ManifestationStorage.reserveStock(client, product.id);
      if (!reserved) {
        await client.query("ROLLBACK");
        return { error: "Produto indisponÃ­vel" };
      }
      await ManifestationStorage.deactivateActiveForUser(client, meta.user_id);
      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;
      const manifestation = await ManifestationStorage.createUserManifestation(client, {
        user_id: meta.user_id,
        product_id: product.id,
        duration_days: product.duration_days,
        payment_method: "stripe",
        stripe_session_id: session.id,
        stripe_payment_intent: paymentIntent,
        amount_cents: session.amount_total ?? product.price_cents,
      });
      await client.query("COMMIT");
      return { manifestation };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async setProfileApply(user, profileId, body = {}) {
    return runWithLogs(log, "setProfileApply", () => ({ id_user: user?.id_user, profileId }), async () => {
      if (!user?.id_user) return { error: "NÃ£o autenticado" };
      const active = await ManifestationStorage.getActiveForUser(pool, user.id_user);
      if (!active) return { error: "VocÃª nÃ£o tem manifestaÃ§Ã£o ativa" };
      const profile = await ManifestationStorage.getOwnedProfileForApply(pool, {
        userId: user.id_user,
        profileId,
      });
      if (!profile) return { error: "Perfil nÃ£o encontrado" };
      if (profile.is_clan) return { error: "ManifestaÃ§Ã£o nÃ£o pode ser aplicada em clans" };
      const result = await ManifestationStorage.setProfileApplied(pool, {
        userManifestationId: active.id,
        profileId,
        enabled: body.enabled !== false,
      });
      const applied = await ManifestationStorage.listAppliedProfileIds(pool, active.id);
      return { result, applied_profile_ids: applied };
    });
  }

  // ---------- Admin: categories ----------

  static async adminListCategories() {
    return { categories: await ManifestationStorage.listCategories(pool) };
  }

  static async adminCreateCategory(body) {
    return runWithLogs(log, "adminCreateCategory", () => ({ slug: body?.slug }), async () => {
      const name = sanitizeText(body?.name, 120);
      if (!name) return { error: "name obrigatório" };
      const slug = sanitizeText(body?.slug, 80) || slugify(name);
      if (!slug) return { error: "slug inválido" };
      const existing = await ManifestationStorage.getCategoryBySlug(pool, slug);
      if (existing) return { error: "Slug já cadastrado" };
      const category = await ManifestationStorage.createCategory(pool, {
        slug,
        name,
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
        is_active: body?.is_active !== false,
      });
      return { category };
    });
  }

  static async adminUpdateCategory(id, body) {
    return runWithLogs(log, "adminUpdateCategory", () => ({ id }), async () => {
      const existing = await ManifestationStorage.getCategoryById(pool, id);
      if (!existing) return { error: "Categoria não encontrada" };
      const patch = {};
      if (body?.name !== undefined) {
        const name = sanitizeText(body.name, 120);
        if (!name) return { error: "name inválido" };
        patch.name = name;
      }
      if (body?.slug !== undefined) {
        const slug = sanitizeText(body.slug, 80);
        if (!slug) return { error: "slug inválido" };
        if (slug !== existing.slug) {
          const dup = await ManifestationStorage.getCategoryBySlug(pool, slug);
          if (dup) return { error: "Slug já cadastrado" };
        }
        patch.slug = slug;
      }
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
      const category = await ManifestationStorage.updateCategory(pool, id, patch);
      return { category };
    });
  }

  static async adminDeleteCategory(id) {
    return runWithLogs(log, "adminDeleteCategory", () => ({ id }), async () => {
      const existing = await ManifestationStorage.getCategoryById(pool, id);
      if (!existing) return { error: "Categoria não encontrada" };
      await ManifestationStorage.deleteCategory(pool, id);
      return { ok: true };
    });
  }

  // ---------- Admin: products ----------

  static async adminListProducts() {
    return { products: await ManifestationStorage.listProducts(pool) };
  }

  static async adminDashboard() {
    return runWithLogs(log, "adminDashboard", () => ({}), async () => {
      return { dashboard: await ManifestationStorage.adminDashboard(pool) };
    });
  }

  static async adminProductUsage(id, query = {}) {
    return runWithLogs(log, "adminProductUsage", () => ({ id }), async () => {
      const product = await ManifestationStorage.getProductById(pool, id);
      if (!product) return { error: "Produto nÃ£o encontrado" };

      const page = Math.max(1, Number(query.page) || 1);
      const per_page = Math.min(Math.max(Number(query.per_page) || 20, 1), 100);
      const q = sanitizeText(query.q, 120) || "";
      const sort = sanitizeText(query.sort, 40) || "acquired_at";
      const order = String(query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
      const isCsv = query.format === "csv";

      if (isCsv) {
        const rows = await ManifestationStorage.listProductUsage(pool, id, {
          q,
          limit: 5000,
          offset: 0,
          sort,
          order,
        });
        return {
          product,
          csv: toCsv(rows),
          filename: `manifestacao-${product.id}-usage.csv`,
        };
      }

      const [total, users] = await Promise.all([
        ManifestationStorage.countProductUsage(pool, id, { q }),
        ManifestationStorage.listProductUsage(pool, id, {
          q,
          limit: per_page,
          offset: (page - 1) * per_page,
          sort,
          order,
        }),
      ]);

      return {
        product,
        users,
        pagination: {
          page,
          per_page,
          total,
          total_pages: Math.max(1, Math.ceil(total / per_page)),
        },
      };
    });
  }

  static async adminGetProduct(id) {
    const product = await ManifestationStorage.getProductById(pool, id);
    if (!product) return { error: "Produto não encontrado" };
    return { product };
  }

  static async adminCreateProduct(body, file) {
    return runWithLogs(log, "adminCreateProduct", () => ({ name: body?.name }), async () => {
      const name = sanitizeText(body?.name, 160);
      const tag_label = sanitizeText(body?.tag_label, 60);
      if (!name) return { error: "name obrigatório" };
      if (!tag_label) return { error: "tag_label obrigatório" };

      let banner_url = sanitizeText(body?.banner_url, 600);
      if (file?.buffer) {
        banner_url = await uploadManifestationBannerToR2({ file, kind: "banner" });
      }
      if (!banner_url) return { error: "banner_url obrigatório (envie arquivo ou URL)" };

      const tag_color = sanitizeText(body?.tag_color, 30) || "emerald";
      if (!ALLOWED_TAG_COLORS.has(tag_color)) return { error: "tag_color inválido" };

      const category_id = body?.category_id ? sanitizeText(body.category_id, 64) : null;
      if (category_id) {
        const cat = await ManifestationStorage.getCategoryById(pool, category_id);
        if (!cat) return { error: "Categoria não encontrada" };
      }

      const data = {
        category_id,
        name,
        description: sanitizeText(body?.description, 2000),
        banner_url,
        banner_thumb_url: sanitizeText(body?.banner_thumb_url, 600),
        tag_label,
        tag_color,
        tag_icon: sanitizeText(body?.tag_icon, 60),
        price_cents: clampInt(body?.price_cents, { fallback: 0 }),
        price_polens: clampInt(body?.price_polens, { fallback: 0 }),
        duration_days: clampInt(body?.duration_days, { min: 1, fallback: 365 }),
        stock: body?.stock != null && body.stock !== "" ? clampInt(body.stock, { min: 0, fallback: 0 }) : null,
        is_featured: body?.is_featured === true || body?.is_featured === "true",
        is_active: body?.is_active !== false && body?.is_active !== "false",
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (data.is_featured) {
          await client.query(
            `UPDATE public.manifestation_products SET is_featured = FALSE, updated_at = NOW() WHERE is_featured = TRUE`
          );
        }
        const product = await ManifestationStorage.createProduct(client, data);
        await client.query("COMMIT");
        return { product };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async adminUpdateProduct(id, body, file) {
    return runWithLogs(log, "adminUpdateProduct", () => ({ id }), async () => {
      const existing = await ManifestationStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };

      const patch = {};
      if (body?.name !== undefined) {
        const v = sanitizeText(body.name, 160);
        if (!v) return { error: "name inválido" };
        patch.name = v;
      }
      if (body?.description !== undefined) patch.description = sanitizeText(body.description, 2000);
      if (body?.tag_label !== undefined) {
        const v = sanitizeText(body.tag_label, 60);
        if (!v) return { error: "tag_label inválido" };
        patch.tag_label = v;
      }
      if (body?.tag_color !== undefined) {
        const v = sanitizeText(body.tag_color, 30);
        if (!v || !ALLOWED_TAG_COLORS.has(v)) return { error: "tag_color inválido" };
        patch.tag_color = v;
      }
      if (body?.tag_icon !== undefined) patch.tag_icon = sanitizeText(body.tag_icon, 60);
      if (body?.banner_thumb_url !== undefined) patch.banner_thumb_url = sanitizeText(body.banner_thumb_url, 600);
      if (body?.price_cents !== undefined) patch.price_cents = clampInt(body.price_cents);
      if (body?.price_polens !== undefined) patch.price_polens = clampInt(body.price_polens);
      if (body?.duration_days !== undefined) patch.duration_days = clampInt(body.duration_days, { min: 1, fallback: 365 });
      if (body?.stock !== undefined) {
        patch.stock = body.stock == null || body.stock === ""
          ? null
          : clampInt(body.stock, { min: 0, fallback: 0 });
      }
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      if (body?.is_active !== undefined) patch.is_active = body.is_active === true || body.is_active === "true";
      if (body?.category_id !== undefined) {
        const cid = body.category_id ? sanitizeText(body.category_id, 64) : null;
        if (cid) {
          const cat = await ManifestationStorage.getCategoryById(pool, cid);
          if (!cat) return { error: "Categoria não encontrada" };
        }
        patch.category_id = cid;
      }

      if (file?.buffer) {
        patch.banner_url = await uploadManifestationBannerToR2({ file, kind: "banner" });
      } else if (body?.banner_url !== undefined) {
        const v = sanitizeText(body.banner_url, 600);
        if (!v) return { error: "banner_url inválido" };
        patch.banner_url = v;
      }

      const product = await ManifestationStorage.updateProduct(pool, id, patch);
      return { product };
    });
  }

  static async adminDeleteProduct(id) {
    return runWithLogs(log, "adminDeleteProduct", () => ({ id }), async () => {
      const existing = await ManifestationStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };
      const product = await ManifestationStorage.deleteProduct(pool, id);
      return { product };
    });
  }

  static async adminFeatureProduct(id) {
    return runWithLogs(log, "adminFeatureProduct", () => ({ id }), async () => {
      const existing = await ManifestationStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };
      if (!existing.is_active) return { error: "Produto inativo não pode ser destaque" };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE public.manifestation_products
              SET is_featured = FALSE, updated_at = NOW()
            WHERE is_featured = TRUE AND id <> $1`,
          [id]
        );
        const { rows } = await client.query(
          `UPDATE public.manifestation_products
              SET is_featured = TRUE, updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [id]
        );
        await client.query("COMMIT");
        return { product: rows[0] || null };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async adminUnfeatureProduct(id) {
    return runWithLogs(log, "adminUnfeatureProduct", () => ({ id }), async () => {
      const product = await ManifestationStorage.unsetFeatured(pool, id);
      if (!product) return { error: "Produto não encontrado" };
      return { product };
    });
  }

  static async adminUploadBanner(file) {
    return runWithLogs(log, "adminUploadBanner", () => ({ name: file?.originalname }), async () => {
      if (!file?.buffer) return { error: "Arquivo obrigatório" };
      const url = await uploadManifestationBannerToR2({ file, kind: "banner" });
      return { url };
    });
  }
}

module.exports = ManifestationService;
