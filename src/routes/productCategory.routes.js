const { Router } = require("express");
const ProductCategoryController = require("../controllers/ProductCategoryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público (loja, formulário de cadastro de produto, "Pedir Produto"):
router.get("/", asyncHandler(ProductCategoryController.listPublic));

module.exports = router;
