// src/routes/workout.routes.js
// Treinos do ALUNO (fase 3). Flag + auth + gate fitness. Montado em /workouts.
// As rotas de staff (fichas/grade) vivem no academy.routes (guard staff no
// service, sem gate fitness — professor pode não ter matrícula ativa).
const { Router } = require("express");
const WorkoutController = require("../controllers/WorkoutController");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const requireFitnessAccess = require("../middlewares/requireFitnessAccess");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("fitness_academias"));
router.use(authMiddleware, requireFitnessAccess);

router.get("/today", asyncHandler(WorkoutController.today));
router.get("/plans", asyncHandler(WorkoutController.myPlans));
router.post("/checks/toggle", asyncHandler(WorkoutController.toggleCheck));

module.exports = router;
