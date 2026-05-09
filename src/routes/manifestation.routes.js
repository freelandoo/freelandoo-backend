const { Router } = require("express");
const ManifestationController = require("../controllers/ManifestationController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/products", asyncHandler(ManifestationController.listProducts));
router.get("/products/:id", asyncHandler(ManifestationController.getProduct));

module.exports = router;
