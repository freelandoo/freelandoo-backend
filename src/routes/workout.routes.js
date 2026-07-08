// src/routes/workout.routes.js
// Treinos do ALUNO (fase 3). Flag + auth (gate de matrícula removido na mig
// 180 — sem academia as listas só vêm vazias). Montado em /workouts.
// As rotas de staff (fichas/grade) vivem no academy.routes; desde a mig 180
// as mutações de staff viram proposta que o aluno confirma.
const { Router } = require("express");
const WorkoutController = require("../controllers/WorkoutController");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("fitness_academias"));
router.use(authMiddleware);

router.get("/today", asyncHandler(WorkoutController.today));
router.get("/plans", asyncHandler(WorkoutController.myPlans));
router.post("/checks/toggle", asyncHandler(WorkoutController.toggleCheck));

module.exports = router;
