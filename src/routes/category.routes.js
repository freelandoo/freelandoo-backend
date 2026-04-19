const { Router } = require("express");
const CategoryController = require("../controllers/CategoryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", asyncHandler(CategoryController.listCategories));
router.get(
  "/with-subcategories",
  asyncHandler(CategoryController.listCategoriesWithSubcategories)
);
router.get(
  "/:id_category/subcategories",
  asyncHandler(CategoryController.listSubcategoriesByCategory)
);

module.exports = router;
