const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const EnxameAdminController = require("../controllers/EnxameAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/enxames", ...admin, asyncHandler(EnxameAdminController.listAll));
router.post("/enxames", ...admin, asyncHandler(EnxameAdminController.create));
router.delete("/enxames/:id_enxame", ...admin, asyncHandler(EnxameAdminController.remove));
router.patch("/enxames/:id_enxame", ...admin, asyncHandler(EnxameAdminController.update));
router.patch(
  "/enxames/:id_enxame/status",
  ...admin,
  asyncHandler(EnxameAdminController.updateStatus)
);
router.post(
  "/enxames/:id_enxame/categories",
  ...admin,
  asyncHandler(EnxameAdminController.addCategory)
);
router.patch(
  "/categories/:id_category",
  ...admin,
  asyncHandler(EnxameAdminController.updateCategory)
);

module.exports = router;
