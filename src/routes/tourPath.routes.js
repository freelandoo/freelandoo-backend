const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const TourPathController = require("../controllers/TourPathController");

const router = Router();

// Lista pública (auth opcional para devolver progresso quando logado)
router.get("/", optionalAuthMiddleware, asyncHandler(TourPathController.listActive));
router.get("/:key", optionalAuthMiddleware, asyncHandler(TourPathController.getByKey));

// Ciclo do tour exige auth
router.post("/:key/start",    authMiddleware, asyncHandler(TourPathController.start));
router.post("/:key/progress", authMiddleware, asyncHandler(TourPathController.progress));
router.post("/:key/complete", authMiddleware, asyncHandler(TourPathController.complete));
router.post("/:key/skip",     authMiddleware, asyncHandler(TourPathController.skip));

module.exports = router;
