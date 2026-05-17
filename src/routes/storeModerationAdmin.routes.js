const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const StoreModerationAdminController = require("../controllers/StoreModerationAdminController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Regras de produtos proibidos
router.get("/prohibited-rules", ...admin, asyncHandler(StoreModerationAdminController.listRules));
router.post("/prohibited-rules", ...admin, asyncHandler(StoreModerationAdminController.createRule));
router.put("/prohibited-rules/:id", ...admin, asyncHandler(StoreModerationAdminController.updateRule));
router.delete("/prohibited-rules/:id", ...admin, asyncHandler(StoreModerationAdminController.removeRule));
router.get("/prohibited-rules/:id/occurrences", ...admin, asyncHandler(StoreModerationAdminController.ruleOccurrences));

// Fila de revisão
router.get("/products/pending", ...admin, asyncHandler(StoreModerationAdminController.listPendingProducts));
router.post("/products/:id/review", ...admin, asyncHandler(StoreModerationAdminController.reviewProduct));
router.post("/product-requests/:id/review", ...admin, asyncHandler(StoreModerationAdminController.reviewRequest));

module.exports = router;
