const { Router } = require("express");
const PremiumAdminController = require("../controllers/PremiumAdminController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/settings", ...admin, asyncHandler(PremiumAdminController.getSettings));
router.put("/settings", ...admin, asyncHandler(PremiumAdminController.updateSettings));

router.get("/cities", ...admin, asyncHandler(PremiumAdminController.listCityOverrides));
router.post("/cities", ...admin, asyncHandler(PremiumAdminController.upsertCityOverride));
router.delete("/cities/:id", ...admin, asyncHandler(PremiumAdminController.deleteCityOverride));

router.get("/active", ...admin, asyncHandler(PremiumAdminController.listActive));

module.exports = router;
