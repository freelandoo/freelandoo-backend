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
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const AcademySocialController = require("../controllers/AcademySocialController");
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
// Avaliação física do professor/dono — desde a mig 180 vira PROPOSTA que o
// aluno confirma no /fitness (guard staff no service).
router.post(
  "/academies/:id/members/:memberId/measurements",
  authMiddleware,
  asyncHandler(require("../controllers/FitnessController").addMemberMeasurement)
);

// Propostas de alteração (mig 180): genérica (measurement/kcal_goal/plan_create),
// lista pendentes do membro e cancelamento pelo staff.
const FitnessProposalController = require("../controllers/FitnessProposalController");
router.post("/academies/:id/members/:memberId/proposals", authMiddleware, asyncHandler(FitnessProposalController.propose));
router.get("/academies/:id/members/:memberId/proposals", authMiddleware, asyncHandler(FitnessProposalController.listForMember));
router.delete("/academies/:id/proposals/:proposalId", authMiddleware, asyncHandler(FitnessProposalController.cancel));

// ─── Social da academia (fase 4) ─────────────────────────────────────────────
// Feed e ranking públicos (vitrine); postar/compartilhar exige auth.
router.get("/academies/:id/posts", asyncHandler(AcademySocialController.listPosts));
router.post(
  "/academies/:id/posts",
  authMiddleware,
  uploadPortfolioMedia.single("media"),
  asyncHandler(AcademySocialController.createPost)
);
router.delete("/academies/:id/posts/:postId", authMiddleware, asyncHandler(AcademySocialController.deletePost));
router.post("/academies/:id/posts/:postId/share", authMiddleware, asyncHandler(AcademySocialController.sharePost));
router.get("/academies/:id/ranking", asyncHandler(AcademySocialController.ranking));
router.get("/academies/:id/goals", asyncHandler(AcademySocialController.getGoals));
router.put("/academies/:id/goals", authMiddleware, asyncHandler(AcademySocialController.setGoals));
router.post(
  "/academies/:id/media",
  authMiddleware,
  uploadPortfolioMedia.single("media"),
  asyncHandler(AcademySocialController.uploadMedia)
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
