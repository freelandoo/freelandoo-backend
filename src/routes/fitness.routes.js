// src/routes/fitness.routes.js
// Diário fitness PESSOAL (água/calorias/medidas/metas/propostas). Desde a
// mig 180 não exige mais matrícula/assinatura (gate requireFitnessAccess
// removido): flag + auth bastam — conectar academia é opcional e só habilita
// frequência/mensalidades/professor. Montado em /fitness.
const { Router } = require("express");
const FitnessController = require("../controllers/FitnessController");
const FitnessProposalController = require("../controllers/FitnessProposalController");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("fitness_academias"));
router.use(authMiddleware);

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

// Propostas do professor (mig 180): aluno lista e confirma/recusa.
router.get("/proposals", asyncHandler(FitnessProposalController.listForStudent));
router.post("/proposals/resolve", asyncHandler(FitnessProposalController.resolve));

module.exports = router;
