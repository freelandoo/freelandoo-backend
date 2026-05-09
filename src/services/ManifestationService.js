const pool = require("../databases");
const ManifestationStorage = require("../storages/ManifestationStorage");
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
