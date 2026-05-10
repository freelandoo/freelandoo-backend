const { Router } = require("express");
const PolenProductController = require("../controllers/PolenProductController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/products", asyncHandler(PolenProductController.listProducts));
router.get("/products/:id", asyncHandler(PolenProductController.getProduct));

module.exports = router;
