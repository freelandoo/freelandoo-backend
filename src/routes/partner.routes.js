// src/routes/partner.routes.js
// API de parceiro de academia (mig 296) — /partner/v1. Auth pela chave de
// parceiro (Bearer flnd_parc_...), NÃO JWT; escopo = a academia da chave.
// Contrato: docs/API_PARTNER.md.
//
// ⚠️ Montado ANTES do academyRoutes no routes/index.js: aquele roteador está em
// "/" com `router.use(requireFeature("fitness_academias"))`, que intercepta
// qualquer caminho que chegue até ele. A API de parceiro não depende da flag
// global (ver middlewares/partnerAuth.js).
const { Router } = require("express");
const partnerAuth = require("../middlewares/partnerAuth");
const uploadAcademyPhoto = require("../middlewares/uploadAcademyPhoto");
const PartnerController = require("../controllers/PartnerController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(partnerAuth);

router.post("/members", asyncHandler(PartnerController.createMember));
router.get("/members", asyncHandler(PartnerController.listMembers));
router.get("/members/:id_user", asyncHandler(PartnerController.getMember));
router.post("/members/:id_user/link", asyncHandler(PartnerController.regenerateLink));
router.put("/members/:id_user/foto-academia", uploadAcademyPhoto, asyncHandler(PartnerController.uploadPhoto));
router.post("/training-reminder", asyncHandler(PartnerController.remindTraining));

module.exports = router;
