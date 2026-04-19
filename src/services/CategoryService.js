const pool = require("../databases");
const CategoryStorage = require("../storages/CategoryStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CategoryService");

class CategoryService {
  static async listCategories(query) {
    return runWithLogs(
      log,
      "listCategories",
      () => ({ include_inactive: query?.include_inactive === "true" }),
      async () => {
        const include_inactive = query?.include_inactive === "true";
        const categories = await CategoryStorage.listCategories(pool, {
          include_inactive,
        });
        return { categories };
      }
    );
  }

  static async listSubcategoriesByCategory(params, query) {
    return runWithLogs(
      log,
      "listSubcategoriesByCategory",
      () => ({ id_category: params?.id_category }),
      async () => {
        const { id_category } = params;
        if (!id_category) return { error: "id_category é obrigatório" };

        const include_inactive = query?.include_inactive === "true";
        const subcategories = await CategoryStorage.listSubcategoriesByCategory(
          pool,
          Number(id_category),
          { include_inactive }
        );
        return { subcategories };
      }
    );
  }

  static async listCategoriesWithSubcategories(query) {
    return runWithLogs(
      log,
      "listCategoriesWithSubcategories",
      () => ({ include_inactive: query?.include_inactive === "true" }),
      async () => {
        const include_inactive = query?.include_inactive === "true";
        const categories = await CategoryStorage.listCategoriesWithSubcategories(
          pool,
          { include_inactive }
        );
        return { categories };
      }
    );
  }
}

module.exports = CategoryService;
