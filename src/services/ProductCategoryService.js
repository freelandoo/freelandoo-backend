const pool = require("../databases");
const ProductCategoryStorage = require("../storages/ProductCategoryStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductCategoryService");

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 140);
}

function validate(payload, { partial = false } = {}) {
  const out = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      return { error: "Nome da categoria é obrigatório" };
    }
    out.name = payload.name.trim().slice(0, 120);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "slug")) {
    if (typeof payload.slug !== "string" || !payload.slug.trim()) {
      return { error: "Slug inválido" };
    }
    out.slug = slugify(payload.slug);
    if (!out.slug) return { error: "Slug inválido" };
  } else if (!partial) {
    out.slug = slugify(out.name);
    if (!out.slug) return { error: "Slug inválido (gere a partir do nome)" };
  }

  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    out.description = payload.description ? String(payload.description).trim() : null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "icon")) {
    out.icon = payload.icon ? String(payload.icon).trim().slice(0, 80) : null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "parent_id")) {
    if (payload.parent_id === null || payload.parent_id === "") {
      out.parent_id = null;
    } else {
      const p = Number(payload.parent_id);
      if (!Number.isInteger(p) || p <= 0) return { error: "parent_id inválido" };
      out.parent_id = p;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    if (!["active", "inactive"].includes(payload.status)) {
      return { error: "status inválido (active|inactive)" };
    }
    out.status = payload.status;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "sort_order")) {
    const n = Number(payload.sort_order);
    if (!Number.isInteger(n) || n < 0) return { error: "sort_order inválido" };
    out.sort_order = n;
  }

  return { data: out };
}

class ProductCategoryService {
  static async listPublic() {
    return runWithLogs(log, "listPublic", () => ({}), async () => {
      const categories = await ProductCategoryStorage.list(pool, { onlyActive: true });
      return { categories };
    });
  }

  static async listAdmin() {
    return runWithLogs(log, "listAdmin", () => ({}), async () => {
      const categories = await ProductCategoryStorage.list(pool, { onlyActive: false });
      return { categories };
    });
  }

  static async getById(id) {
    return runWithLogs(log, "getById", () => ({ id }), async () => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id inválido" };
      const category = await ProductCategoryStorage.getById(pool, numId);
      if (!category) return { error: "Categoria não encontrada" };
      return { category };
    });
  }

  static async create(user, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      const v = validate(body || {});
      if (v.error) return { error: v.error };

      const existing = await ProductCategoryStorage.getBySlug(pool, v.data.slug);
      if (existing) return { error: "Já existe categoria com este slug" };

      const category = await ProductCategoryStorage.create(pool, v.data);
      return { category };
    });
  }

  static async update(user, id, body) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, id }), async () => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id inválido" };

      const existing = await ProductCategoryStorage.getById(pool, numId);
      if (!existing) return { error: "Categoria não encontrada" };

      const v = validate(body || {}, { partial: true });
      if (v.error) return { error: v.error };
      if (!Object.keys(v.data).length) return { error: "Nenhum campo para atualizar" };

      if (v.data.slug && v.data.slug !== existing.slug) {
        const other = await ProductCategoryStorage.getBySlug(pool, v.data.slug);
        if (other && other.id_product_category !== numId) {
          return { error: "Já existe outra categoria com este slug" };
        }
      }

      if (v.data.parent_id === numId) return { error: "Categoria não pode ser pai de si mesma" };

      const category = await ProductCategoryStorage.update(pool, numId, v.data);
      return { category };
    });
  }

  static async remove(user, id) {
    return runWithLogs(log, "remove", () => ({ id_user: user?.id_user, id }), async () => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id inválido" };

      const existing = await ProductCategoryStorage.getById(pool, numId);
      if (!existing) return { error: "Categoria não encontrada" };

      const productCount = await ProductCategoryStorage.countProductsByCategory(pool, numId);
      if (productCount > 0) {
        return {
          error: `Categoria possui ${productCount} produto(s) vinculado(s). Inative-a em vez de excluir.`,
        };
      }

      await ProductCategoryStorage.remove(pool, numId);
      return { message: "Categoria removida" };
    });
  }
}

module.exports = ProductCategoryService;
module.exports.slugify = slugify;
