// src/routes/aiKnowledge.routes.js
// A base de conhecimento do atendente (mig 253), montada em /me/atendimento-ai.
//
// ⚠️ O ENDEREÇO É `/me/...` MESMO COM O ACESSO FECHADO AO ADMIN, e é decisão:
// a base é DE UMA CONTA, não da administração. Montá-la em `/admin/...` hoje
// obrigaria a mover a URL no dia em que os assinantes entrarem — e URL que se
// move quebra front em cache. Quem decide o direito é o `requireAiAccess`, num
// arquivo só (ver o comentário de lá).
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireAiAccess = require("../middlewares/requireAiAccess");
const requireFeature = require("../middlewares/requireFeature");
const uploadKnowledgePdf = require("../middlewares/uploadKnowledgePdf");
const AiKnowledgeController = require("../controllers/AiKnowledgeController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
router.use(authMiddleware, requireFeature("atendimento_ai"), requireAiAccess);

router.get("/knowledge", asyncHandler(AiKnowledgeController.list));
router.post("/knowledge", asyncHandler(AiKnowledgeController.createText));
// Campo `file` no multipart; o título é opcional (cai no nome do arquivo).
router.post("/knowledge/pdf", uploadKnowledgePdf.single("file"), asyncHandler(AiKnowledgeController.createPdf));
router.patch("/knowledge/:id_knowledge", asyncHandler(AiKnowledgeController.update));
router.delete("/knowledge/:id_knowledge", asyncHandler(AiKnowledgeController.remove));

// O dossiê como o modelo vai lê-lo — é o que tira a caixa-preta do caminho.
router.get("/preview", asyncHandler(AiKnowledgeController.preview));

module.exports = router;
