// src/routes/academy.routes.js
// Fitness & Academias — fase 1. Tudo atrás da flag fitness_academias (OFF por
// padrão). Montado em "/" (paths absolutos aqui) para cobrir /academies e
// /me/academies num router só.
const { Router } = require("express");
const AcademyController = require("../controllers/AcademyController");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const { auth: authLimiter } = require("../middlewares/rateLimit");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("fitness_academias"));

// ─── Público ────────────────────────────────────────────────────────────────
router.get("/academies", asyncHandler(AcademyController.search));
router.get("/academies/slug/:slug", optionalAuthMiddleware, asyncHandler(AcademyController.getBySlug));

// ─── Usuário (auth) ─────────────────────────────────────────────────────────
router.get("/me/academies", authMiddleware, asyncHandler(AcademyController.listMine));
router.get("/me/academy-memberships", authMiddleware, asyncHandler(AcademyController.myMemberships));
router.post("/academies", authMiddleware, asyncHandler(AcademyController.create));
router.patch("/academies/:id", authMiddleware, asyncHandler(AcademyController.update));
router.post("/academies/:id/test-connection", authMiddleware, asyncHandler(AcademyController.testConnection));
router.post("/academies/:id/sync", authMiddleware, asyncHandler(AcademyController.syncNow));

// Vínculo por CPF — rate-limited (consulta provider externo).
router.post("/academies/:id/link", authMiddleware, authLimiter, asyncHandler(AcademyController.link));
router.delete("/academies/:id/link", authMiddleware, asyncHandler(AcademyController.unlink));

// ─── Gestão (dono) / staff ──────────────────────────────────────────────────
router.get("/academies/:id/members", authMiddleware, asyncHandler(AcademyController.listMembers));
// Avaliação física registrada pelo professor/dono (guard staff no service).
router.post(
  "/academies/:id/members/:memberId/measurements",
  authMiddleware,
  asyncHandler(require("../controllers/FitnessController").addMemberMeasurement)
);

// ─── Treinos (staff: professor/dono — guard no service) ─────────────────────
const WorkoutController = require("../controllers/WorkoutController");
router.get("/academies/:id/exercises", authMiddleware, asyncHandler(WorkoutController.listExercises));
router.get("/academies/:id/training-grid", authMiddleware, asyncHandler(WorkoutController.trainingGrid));
router.get("/academies/:id/members/:memberId/plans", authMiddleware, asyncHandler(WorkoutController.memberPlans));
router.post("/academies/:id/members/:memberId/plans", authMiddleware, asyncHandler(WorkoutController.createPlan));
router.patch("/academies/:id/plans/:planId", authMiddleware, asyncHandler(WorkoutController.updatePlan));
router.delete("/academies/:id/plans/:planId", authMiddleware, asyncHandler(WorkoutController.deletePlan));
router.post("/academies/:id/professors", authMiddleware, asyncHandler(AcademyController.addProfessor));
router.delete("/academies/:id/professors/:userId", authMiddleware, asyncHandler(AcademyController.removeProfessor));

module.exports = router;
