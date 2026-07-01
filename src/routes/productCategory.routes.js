const { Router } = require("express");
const ProductCategoryController = require("../controllers/ProductCategoryController");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Categorias só fazem sentido com a Loja/Produtos ligada.
router.use(requireFeature("store"));

// Público (loja, formulário de cadastro de produto, "Pedir Produto"):
router.get("/", asyncHandler(ProductCategoryController.listPublic));

module.exports = router;
