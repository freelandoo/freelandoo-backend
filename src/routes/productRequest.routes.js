const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const asyncHandler = require("../utils/asyncHandler");
const ProductRequestController = require("../controllers/ProductRequestController");

const router = Router();
const auth = [authMiddleware];

router.post("/", ...auth, uploadAvatar.single("reference_image"), asyncHandler(ProductRequestController.create));
router.get("/me", ...auth, asyncHandler(ProductRequestController.listMine));
router.get("/mural", ...auth, asyncHandler(ProductRequestController.muralForProfile));
router.get("/:id/eligible-products", ...auth, asyncHandler(ProductRequestController.eligibleProducts));
router.get("/:id/responses", ...auth, asyncHandler(ProductRequestController.listResponses));
router.post("/:id/responses", ...auth, asyncHandler(ProductRequestController.createResponse));
router.get("/:id", ...auth, asyncHandler(ProductRequestController.getById));
router.post("/:id/cancel", ...auth, asyncHandler(ProductRequestController.cancel));
router.post("/:id/close", ...auth, asyncHandler(ProductRequestController.close));

module.exports = router;
