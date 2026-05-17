const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const ProductCategoryController = require("../controllers/ProductCategoryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/", ...admin, asyncHandler(ProductCategoryController.listAdmin));
router.get("/:id", ...admin, asyncHandler(ProductCategoryController.getById));
router.post("/", ...admin, asyncHandler(ProductCategoryController.create));
router.put("/:id", ...admin, asyncHandler(ProductCategoryController.update));
router.delete("/:id", ...admin, asyncHandler(ProductCategoryController.remove));

module.exports = router;
