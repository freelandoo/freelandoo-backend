const pool = require("../databases");
const ProductRequestStorage = require("../storages/ProductRequestStorage");
const ProductCategoryStorage = require("../storages/ProductCategoryStorage");
const uploadProductRequestImage = require("../integrations/r2/uploadProductRequestImage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductRequestService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validate(payload) {
  const out = {};

  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (title.length < 3) return { error: "Título obrigatório (mín. 3 caracteres)" };
  out.title = title.slice(0, 160);

  const description = typeof payload?.description === "string" ? payload.description.trim() : "";
  if (description.length < 5) return { error: "Descrição obrigatória (mín. 5 caracteres)" };
  out.description = description.slice(0, 4000);

  const city = typeof payload?.city === "string" ? payload.city.trim() : "";
  if (!city) return { error: "Cidade obrigatória" };
  out.city = city.slice(0, 120);

  const state = typeof payload?.state === "string" ? payload.state.trim().toUpperCase() : "";
  if (state.length !== 2) return { error: "Estado inválido (UF de 2 letras)" };
  out.state = state;

  const cat = Number(payload?.id_product_category);
  if (!Number.isInteger(cat) || cat <= 0) return { error: "Categoria inválida" };
  out.id_product_category = cat;

  if (payload?.min_price_cents !== undefined && payload?.min_price_cents !== null && payload?.min_price_cents !== "") {
    const n = Number(payload.min_price_cents);
    if (!Number.isInteger(n) || n < 0) return { error: "min_price_cents inválido" };
    out.min_price_cents = n;
  }
  if (payload?.max_price_cents !== undefined && payload?.max_price_cents !== null && payload?.max_price_cents !== "") {
    const n = Number(payload.max_price_cents);
    if (!Number.isInteger(n) || n < 0) return { error: "max_price_cents inválido" };
    out.max_price_cents = n;
  }
  if (out.min_price_cents != null && out.max_price_cents != null && out.min_price_cents > out.max_price_cents) {
    return { error: "Preço mínimo não pode ser maior que o máximo" };
  }

  return { data: out };
}

class ProductRequestService {
  static async create(user, body, file) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };

      const v = validate(body || {});
      if (v.error) return { error: v.error };

      const cat = await ProductCategoryStorage.getById(pool, v.data.id_product_category);
      if (!cat || cat.status !== "active") return { error: "Categoria inválida ou inativa" };

      let reference_image_url = null;
      let reference_image_key = null;
      if (file && file.buffer) {
        const mime = String(file.mimetype || "").toLowerCase();
        if (!mime.startsWith("image/")) return { error: "Imagem de referência deve ser JPG/PNG/WebP" };
        const up = await uploadProductRequestImage({ file });
        reference_image_url = up.url;
        reference_image_key = up.key;
      }

      const request = await ProductRequestStorage.create(pool, {
        id_buyer_user: user.id_user,
        ...v.data,
        reference_image_url,
        reference_image_key,
      });
      return { request };
    });
  }

  static async listMine(user) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const requests = await ProductRequestStorage.listByBuyer(pool, user.id_user);
      return { requests };
    });
  }

  static async getById(user, id_product_request) {
    return runWithLogs(log, "getById", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      // No slice 2 só o comprador acessa o detalhe; slice 3 abre p/ vendedores compatíveis.
      if (String(r.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      return { request: r };
    });
  }

  static async cancel(user, id_product_request) {
    return runWithLogs(log, "cancel", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      if (String(r.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      if (!["open", "answered", "negotiating"].includes(r.status)) {
        return { error: "Pedido não pode ser cancelado neste estado" };
      }
      const updated = await ProductRequestStorage.cancel(pool, id_product_request);
      return { request: updated };
    });
  }

  static async close(user, id_product_request) {
    return runWithLogs(log, "close", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      if (String(r.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      if (!["open", "answered", "negotiating"].includes(r.status)) {
        return { error: "Pedido não pode ser fechado neste estado" };
      }
      const updated = await ProductRequestStorage.close(pool, id_product_request);
      return { request: updated };
    });
  }
}

module.exports = ProductRequestService;
