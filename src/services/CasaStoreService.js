const pool = require("../databases");
const CasaStoreStorage = require("../storages/CasaStoreStorage");
const CasaProductStorage = require("../storages/CasaProductStorage");
const uploadCasaParticipantMediaToR2 = require("../integrations/r2/uploadCasaParticipantMedia");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CasaStoreService");

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

class CasaStoreService {
  // ─── Público: vitrine única (espelhada em toda página de participante) ───
  static async listPublic() {
    return runWithLogs(log, "listPublic", () => ({}), async () => {
      const products = await CasaStoreStorage.listProductsWithMedia(pool, { onlyActive: true });
      return { products };
    });
  }

  // ─── Admin: produtos ───
  static async adminList() {
    return { products: await CasaStoreStorage.listProductsWithMedia(pool) };
  }

  static async adminGet(id) {
    const product = await CasaStoreStorage.getProductWithMedia(pool, id);
    if (!product) return { error: "Produto não encontrado" };
    return { product };
  }

  static async adminCreate(body) {
    return runWithLogs(log, "adminCreate", () => ({ name: body?.name }), async () => {
      const name = txt(body?.name, 160);
      if (!name) return { error: "name obrigatório" };
      const product = await CasaStoreStorage.createProduct(pool, {
        name,
        description: txt(body?.description, 2000),
        image_url: txt(body?.image_url, 600),
        price_cents: clampInt(body?.price_cents, { fallback: 0 }),
        stock: body?.stock == null || body?.stock === "" ? null : clampInt(body.stock, { min: 0, fallback: 0 }),
        is_active: boolish(body?.is_active, true),
        sort_order: clampInt(body?.sort_order, { fallback: 0 }),
      });
      return { product };
    });
  }

  static async adminUpdate(id, body) {
    return runWithLogs(log, "adminUpdate", () => ({ id }), async () => {
      const existing = await CasaStoreStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };
      const patch = {};
      if (body?.name !== undefined) { const v = txt(body.name, 160); if (!v) return { error: "name inválido" }; patch.name = v; }
      if (body?.description !== undefined) patch.description = txt(body.description, 2000);
      if (body?.image_url !== undefined) patch.image_url = txt(body.image_url, 600);
      if (body?.price_cents !== undefined) patch.price_cents = clampInt(body.price_cents);
      if (body?.stock !== undefined) patch.stock = body.stock == null || body.stock === "" ? null : clampInt(body.stock, { min: 0, fallback: 0 });
      if (body?.is_active !== undefined) patch.is_active = boolish(body.is_active, true);
      if (body?.sort_order !== undefined) patch.sort_order = clampInt(body.sort_order);
      const product = await CasaStoreStorage.updateProduct(pool, id, patch);
      return { product };
    });
  }

  static async adminDelete(id) {
    return runWithLogs(log, "adminDelete", () => ({ id }), async () => {
      const existing = await CasaStoreStorage.getProductById(pool, id);
      if (!existing) return { error: "Produto não encontrado" };
      const product = await CasaStoreStorage.deleteProduct(pool, id);
      return { product };
    });
  }

  // ─── Admin: mídia (galeria) ───
  static async adminAddMedia(id_product, file, body = {}) {
    return runWithLogs(log, "adminAddMedia", () => ({ id_product }), async () => {
      const product = await CasaStoreStorage.getProductById(pool, id_product);
      if (!product) return { error: "Produto não encontrado" };
      let media_url = txt(body?.media_url, 600);
      if (file?.buffer) media_url = await uploadCasaParticipantMediaToR2({ file, kind: "product" });
      if (!media_url) return { error: "Envie um arquivo ou media_url" };
      const media = await CasaStoreStorage.addMedia(pool, { id_product, media_url, media_type: "image" });
      await CasaStoreStorage.refreshCover(pool, id_product);
      return { media };
    });
  }

  static async adminDeleteMedia(id_media) {
    return runWithLogs(log, "adminDeleteMedia", () => ({ id_media }), async () => {
      const id_product = await CasaStoreStorage.deleteMedia(pool, id_media);
      if (id_product) await CasaStoreStorage.refreshCover(pool, id_product);
      return { ok: true };
    });
  }

  static async adminReorderMedia(id_product, body = {}) {
    return runWithLogs(log, "adminReorderMedia", () => ({ id_product }), async () => {
      const ids = Array.isArray(body?.ordered_ids) ? body.ordered_ids : [];
      await CasaStoreStorage.reorderMedia(pool, id_product, ids);
      await CasaStoreStorage.refreshCover(pool, id_product);
      return { media: await CasaStoreStorage.listMedia(pool, id_product) };
    });
  }

  // ─── Admin: pedidos (com atribuição do participante) ───
  static async adminListOrders(query = {}) {
    return runWithLogs(log, "adminListOrders", () => ({}), async () => {
      const limit = clampInt(query.limit, { min: 1, max: 200, fallback: 100 });
      const offset = clampInt(query.offset, { fallback: 0 });
      const status = txt(query.status, 20);
      const orders = await CasaProductStorage.listOrdersAdmin(pool, { limit, offset, status });
      return { orders };
    });
  }
}

module.exports = CasaStoreService;
