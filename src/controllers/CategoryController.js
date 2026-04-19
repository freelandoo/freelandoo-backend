const CategoryService = require("../services/CategoryService");

class CategoryController {
  static async listCategories(req, res) {
    const result = await CategoryService.listCategories(req.query);
    return res.json(result);
  }

  static async listSubcategoriesByCategory(req, res) {
    const result = await CategoryService.listSubcategoriesByCategory(
      req.params,
      req.query
    );
    return res.json(result);
  }

  static async listCategoriesWithSubcategories(req, res) {
    const result = await CategoryService.listCategoriesWithSubcategories(
      req.query
    );
    return res.json(result);
  }
}

module.exports = CategoryController;
