// src/routes/classificacao.routes.js
//
// A6 CLASSIFICAÇÃO (migs 395/396): a prova (nota 0–100 pela TRI), quem vê a nota
// e o perfil de personalidade (Big Five/IPIP-50, privado, com consentimento).
//
// Montado em /classificacao (logado) e /public/classificacao (sem login, só a
// nota, e só quando a pessoa abriu: link ou perfil).
//
// ⚠️ APAGAR O PERFIL DE PERSONALIDADE NÃO PASSA POR FLAG NENHUMA: porta de saída
// trancada é a única que não pode existir.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const C = require("../controllers/ClassificacaoController");

const router = Router();
router.get("/me", authMiddleware, asyncHandler(C.me));
router.post("/attempts", authMiddleware, asyncHandler(C.start));
router.post("/attempts/:id_attempt/answer", authMiddleware, asyncHandler(C.answer));
router.put("/me/visibility", authMiddleware, asyncHandler(C.visibility));

router.get("/personality", authMiddleware, asyncHandler(C.personality));
router.post("/personality/consent", authMiddleware, asyncHandler(C.consent));
router.put("/personality", authMiddleware, asyncHandler(C.savePersonality));
router.delete("/personality", authMiddleware, asyncHandler(C.deletePersonality));

const publicRouter = Router();
publicRouter.get("/link/:token", asyncHandler(C.publicByToken));
publicRouter.get("/user/:username", asyncHandler(C.publicByUsername));

module.exports = router;
module.exports.publicRouter = publicRouter;
