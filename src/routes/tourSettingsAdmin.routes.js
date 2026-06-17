const { Router } = require("express");
const TourSettingsController = require("../controllers/TourSettingsController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const adminGuard = [authMiddleware, roleMiddleware("Administrator")];

// Configuração do auto-tour de boas-vindas.
router.get("/settings", adminGuard, asyncHandler(TourSettingsController.get));
router.put("/settings", adminGuard, asyncHandler(TourSettingsController.update));

module.exports = router;
