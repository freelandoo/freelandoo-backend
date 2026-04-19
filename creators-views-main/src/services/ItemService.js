const db = require("../databases");
const ItemStorage = require("../storages/ItemStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ItemService");

class ItemService {
  static validateCreatePayload(payload) {
    const { desc_item, details, unity_price_cents, currency, is_active } =
      payload;

    if (!desc_item || typeof desc_item !== "string" || !desc_item.trim()) {
      const err = new Error("O campo 'desc_item' é obrigatório.");
      err.statusCode = 400;
      throw err;
    }

    if (
      details !== undefined &&
      details !== null &&
      typeof details !== "string"
    ) {
      const err = new Error("O campo 'details' deve ser uma string.");
      err.statusCode = 400;
      throw err;
    }

    if (unity_price_cents === undefined || unity_price_cents === null) {
      const err = new Error("O campo 'unity_price_cents' é obrigatório.");
      err.statusCode = 400;
      throw err;
    }

    const numericPrice = Number(unity_price_cents);

    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      const err = new Error(
        "O campo 'unity_price_cents' deve ser um número maior ou igual a 0."
      );
      err.statusCode = 400;
      throw err;
    }

    if (currency !== undefined && currency !== null) {
      if (typeof currency !== "string" || !currency.trim()) {
        const err = new Error("O campo 'currency' deve ser uma string válida.");
        err.statusCode = 400;
        throw err;
      }
    }

    if (is_active !== undefined && typeof is_active !== "boolean") {
      const err = new Error("O campo 'is_active' deve ser boolean.");
      err.statusCode = 400;
      throw err;
    }
  }

  static validateUpdatePayload(payload) {
    const { desc_item, details, unity_price_cents, currency, is_active } =
      payload;

    if (
      desc_item !== undefined &&
      (typeof desc_item !== "string" || !desc_item.trim())
    ) {
      const err = new Error(
        "O campo 'desc_item' deve ser uma string não vazia."
      );
      err.statusCode = 400;
      throw err;
    }

    if (
      details !== undefined &&
      details !== null &&
      typeof details !== "string"
    ) {
      const err = new Error("O campo 'details' deve ser uma string.");
      err.statusCode = 400;
      throw err;
    }

    if (unity_price_cents !== undefined && unity_price_cents !== null) {
      const numericPrice = Number(unity_price_cents);

      if (Number.isNaN(numericPrice) || numericPrice < 0) {
        const err = new Error(
          "O campo 'unity_price_cents' deve ser um número maior ou igual a 0."
        );
        err.statusCode = 400;
        throw err;
      }
    }

    if (currency !== undefined && currency !== null) {
      if (typeof currency !== "string" || !currency.trim()) {
        const err = new Error("O campo 'currency' deve ser uma string válida.");
        err.statusCode = 400;
        throw err;
      }
    }

    if (is_active !== undefined && typeof is_active !== "boolean") {
      const err = new Error("O campo 'is_active' deve ser boolean.");
      err.statusCode = 400;
      throw err;
    }
  }

  static async create(user, payload) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user.id_user }),
      async () => {
        ItemService.validateCreatePayload(payload);

        const createPayload = {
          desc_item: payload.desc_item.trim(),
          details: payload.details ?? null,
          unity_price_cents: Number(payload.unity_price_cents),
          currency: (payload.currency || "BRL").trim().toUpperCase(),
          created_by: user.id_user,
          updated_by: user.id_user,
          is_active: payload.is_active ?? true,
        };

        return await ItemStorage.create(db, createPayload);
      }
    );
  }

  static async list(query = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({
        page: query.page,
        limit: query.limit,
        is_active: query.is_active,
      }),
      async () => {
        const page = Math.max(Number(query.page) || 1, 1);
        const limit = Math.max(Number(query.limit) || 10, 1);
        const offset = (page - 1) * limit;

        const filters = {
          is_active:
            query.is_active !== undefined
              ? String(query.is_active).toLowerCase() === "true"
              : undefined,
          q: query.q || undefined,
          currency: query.currency || undefined,
          limit,
          offset,
        };

        return await ItemStorage.list(db, filters);
      }
    );
  }

  static async getById(id_item) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_item }),
      async () => {
        if (!id_item) {
          const err = new Error("O parâmetro 'id_item' é obrigatório.");
          err.statusCode = 400;
          throw err;
        }

        const item = await ItemStorage.getById(db, id_item);

        if (!item) {
          const err = new Error("Item não encontrado.");
          err.statusCode = 404;
          throw err;
        }

        return item;
      }
    );
  }

  static async update(id_item, user, payload) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_item, id_user: user.id_user }),
      async () => {
        if (!id_item) {
          const err = new Error("O parâmetro 'id_item' é obrigatório.");
          err.statusCode = 400;
          throw err;
        }

        ItemService.validateUpdatePayload(payload);

        const existing = await ItemStorage.getById(db, id_item);

        if (!existing) {
          const err = new Error("Item não encontrado.");
          err.statusCode = 404;
          throw err;
        }

        const updatePayload = {
          desc_item:
            payload.desc_item !== undefined
              ? payload.desc_item.trim()
              : existing.desc_item,
          details:
            payload.details !== undefined ? payload.details : existing.details,
          unity_price_cents:
            payload.unity_price_cents !== undefined
              ? Number(payload.unity_price_cents)
              : existing.unity_price_cents,
          currency:
            payload.currency !== undefined
              ? payload.currency.trim().toUpperCase()
              : existing.currency,
          is_active:
            payload.is_active !== undefined
              ? payload.is_active
              : existing.is_active,
          updated_by: user.id_user,
        };

        return await ItemStorage.update(db, id_item, updatePayload);
      }
    );
  }

  static async toggleActive(id_item, user, is_active) {
    return runWithLogs(
      log,
      "toggleActive",
      () => ({ id_item, id_user: user.id_user, is_active }),
      async () => {
        if (!id_item) {
          const err = new Error("O parâmetro 'id_item' é obrigatório.");
          err.statusCode = 400;
          throw err;
        }

        if (typeof is_active !== "boolean") {
          const err = new Error("O campo 'is_active' deve ser boolean.");
          err.statusCode = 400;
          throw err;
        }

        const existing = await ItemStorage.getById(db, id_item);

        if (!existing) {
          const err = new Error("Item não encontrado.");
          err.statusCode = 404;
          throw err;
        }

        return await ItemStorage.toggleActive(db, {
          id_item,
          is_active,
          updated_by: user.id_user,
        });
      }
    );
  }

  static async delete(id_item, user) {
    return runWithLogs(
      log,
      "delete",
      () => ({ id_item, id_user: user.id_user }),
      async () => {
        if (!id_item) {
          const err = new Error("O parâmetro 'id_item' é obrigatório.");
          err.statusCode = 400;
          throw err;
        }

        const existing = await ItemStorage.getById(db, id_item);

        if (!existing) {
          const err = new Error("Item não encontrado.");
          err.statusCode = 404;
          throw err;
        }

        return await ItemStorage.softDelete(db, {
          id_item,
          updated_by: user.id_user,
        });
      }
    );
  }
}

module.exports = ItemService;
