const { Router } = require("express");
const VaquinhaController = require("../controllers/VaquinhaController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const adminGuard = [authMiddleware, roleMiddleware("Administrator")];

// Taxa da plataforma / prazo máximo / doação mínima.
router.get("/settings", adminGuard, asyncHandler(VaquinhaController.getSettings));
router.put("/settings", adminGuard, asyncHandler(VaquinhaController.updateSettings));

module.exports = router;
