const { Router } = require("express");
const PolenProductController = require("../controllers/PolenProductController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/products", asyncHandler(PolenProductController.listProducts));
router.get("/products/:id", asyncHandler(PolenProductController.getProduct));
router.post("/products/:id/checkout", authMiddleware, asyncHandler(PolenProductController.checkout));

module.exports = router;
