// src/routes/academyOnboarding.routes.js
// Modal de aceite da conta criada pela academia (mig 296). Logado (JWT).
// Sem a flag fitness_academias de propósito: a conta já existe e o aluno
// precisa conseguir aceitar ou recusar mesmo com o painel fitness desligado.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { acceptBody } = require("../schemas/academyOnboardingSchemas");
const AcademyOnboardingController = require("../controllers/AcademyOnboardingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(authMiddleware);

router.get("/", asyncHandler(AcademyOnboardingController.state));
router.get("/foto", asyncHandler(AcademyOnboardingController.photo));
router.post("/aceite", validate({ body: acceptBody }), asyncHandler(AcademyOnboardingController.accept));
router.post("/recusa", asyncHandler(AcademyOnboardingController.refuse));

module.exports = router;
