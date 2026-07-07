// src/routes/fitness.routes.js
// Diário fitness (fase 2). Flag fitness_academias + gate de acesso (matrícula
// ativa OU subperfil pago) em TODAS as rotas. Montado em /fitness.
const { Router } = require("express");
const FitnessController = require("../controllers/FitnessController");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const requireFitnessAccess = require("../middlewares/requireFitnessAccess");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("fitness_academias"));
router.use(authMiddleware, requireFitnessAccess);

router.get("/summary", asyncHandler(FitnessController.summary));

// Alimentos
router.get("/foods", asyncHandler(FitnessController.searchFoods));
router.get("/foods/off", asyncHandler(FitnessController.searchOff));
router.post("/foods/off/cache", asyncHandler(FitnessController.cacheOffFood));
router.post("/foods/custom", asyncHandler(FitnessController.createCustomFood));

// Diário de refeições
router.post("/food-logs", asyncHandler(FitnessController.addFoodLog));
router.delete("/food-logs/:id", asyncHandler(FitnessController.deleteFoodLog));

// Água
router.put("/water", asyncHandler(FitnessController.setWater));

// Medidas
router.get("/measurements", asyncHandler(FitnessController.listMeasurements));
router.post("/measurements", asyncHandler(FitnessController.addMeasurement));

// Metas
router.put("/settings", asyncHandler(FitnessController.setSettings));

module.exports = router;
