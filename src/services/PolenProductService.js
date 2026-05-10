const pool = require("../databases");
const PolenProductStorage = require("../storages/PolenProductStorage");
const uploadPolenProductImageToR2 = require("../integrations/r2/uploadPolenProductImage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PolenProductService");

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

class PolenProductService {
  // ---------- Public ----------

  static async listPublic() {
    return runWithLogs(log, "listPublic", () => ({}), async () => {
      const products = await PolenProductStorage.listProducts(pool, { onlyActive: true });
      return { products };
    });
  }

  static async getPublic(id) {
    return runWithLogs(log, "getPublic", () => ({ id }), async () => {
      if (!id) return { error: "id obrigatório" };
      const product = await PolenProductStorage.getProductById(pool, id);
      if (!product || !product.is_active) return { error: "Produto não encontrado" };
      return { product };
    });
  }

  // ---------- Admin ----------

  static async adminListProducts() {
    return { products: await PolenProductStorage.listProducts(pool) };
  }

  static async adminGetProduct(id) {
    const product = await PolenProductStorage.getProductById(pool, id);
    if (!product) return { error: "Produto não encontrado" };
    return { product };
  }

  static async adminCreateProduct(body, file) {
    return runWithLogs(log, "adminCreateProduct", () => ({ name: body?.name }), async () => {
      const name = sanitizeText(body?.name, 160);
      if (!name) return { error: "name obrigatório" };

      const price_cents = clampInt(body?.price_cents, { min: 1, fallback: 0 });
      if (price_cents <= 0) return { error: "price_cents deve ser maior que zero" };

      const polens_amount = clampInt(body?.polens_amount, { min: 1, fallback: 0 });
      if (polens_amount <= 0) return { error: "polens_amount deve ser maior que zero" };

      let image_url = sanitizeText(body?.image_url, 600);
      if (file?.buffer) {
        image_url = await uploadPolenProductImageToR2({ file });
      }

      const data = {
        name,
        description: sanitizeText(body?.description, 2000),
        image_url,
        price_cents,
        polens_amount,
        bonus_polens: clampInt(body?.bonus_polens, { fallback: 0 }),
        is_active: body?.is_active !== false && body?.is_active !== "false",
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      };

      const product = await PolenProductStorage.createProduct(pool, data);
      return { product };
    });
  }

  static async adminUpdateProduct(id, body, file) {
    return runWithLogs(log, "adminUpdateProduct", () => ({ id }), async () => {
      const existing = await PolenProductStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };

      const patch = {};
      if (body?.name !== undefined) {
        const v = sanitizeText(body.name, 160);
        if (!v) return { error: "name inválido" };
        patch.name = v;
      }
      if (body?.description !== undefined) patch.description = sanitizeText(body.description, 2000);
      if (body?.price_cents !== undefined) {
        const v = clampInt(body.price_cents, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "price_cents deve ser maior que zero" };
        patch.price_cents = v;
      }
      if (body?.polens_amount !== undefined) {
        const v = clampInt(body.polens_amount, { min: 1, fallback: 0 });
        if (v <= 0) return { error: "polens_amount deve ser maior que zero" };
        patch.polens_amount = v;
      }
      if (body?.bonus_polens !== undefined) patch.bonus_polens = clampInt(body.bonus_polens);
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      if (body?.is_active !== undefined) {
        patch.is_active = body.is_active === true || body.is_active === "true";
      }

      if (file?.buffer) {
        patch.image_url = await uploadPolenProductImageToR2({ file });
      } else if (body?.image_url !== undefined) {
        patch.image_url = sanitizeText(body.image_url, 600);
      }

      const product = await PolenProductStorage.updateProduct(pool, id, patch);
      return { product };
    });
  }

  static async adminDeleteProduct(id) {
    return runWithLogs(log, "adminDeleteProduct", () => ({ id }), async () => {
      const existing = await PolenProductStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };
      const product = await PolenProductStorage.deleteProduct(pool, id);
      return { product };
    });
  }

  static async adminUploadImage(file) {
    return runWithLogs(log, "adminUploadImage", () => ({ name: file?.originalname }), async () => {
      if (!file?.buffer) return { error: "Arquivo obrigatório" };
      const url = await uploadPolenProductImageToR2({ file });
      return { url };
    });
  }
}

module.exports = PolenProductService;
