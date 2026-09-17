// src/routes/aiAdmin.routes.js
// Painel "Atendimento" do admin (mig 253): as duas chaves, o teste, o medidor
// e a fila de respostas.
//
// ⚠️ SEM `requireFeature("atendimento_ai")` aqui, e é decisão. Aquela flag é o
// kill-switch de RESPONDER; gateá-la também na configuração trancaria o admin
// para fora do painel justamente depois de desligar o atendente para conter um
// problema — que é quando ele mais precisa entrar para ver o que aconteceu.
// (Mesma regra das rotas de `/admin/managed-sites`.)
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const AiAdminController = require("../controllers/AiAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
router.use(authMiddleware, roleMiddleware("Administrator"));

router.get("/settings", asyncHandler(AiAdminController.settings));
router.get("/usage", asyncHandler(AiAdminController.usage));
router.get("/jobs", asyncHandler(AiAdminController.jobs));

// ⚠️ `/keys/:provider/test` vem ANTES de `/keys/:provider` no método POST? Não
// precisa: são caminhos de comprimento diferente e o Express casa o literal
// `test` como segmento próprio. O que NÃO pode é `:provider` capturar dois
// segmentos — e ele não captura.
router.post("/keys/:provider/test", asyncHandler(AiAdminController.testKey));
router.put("/keys/:provider", asyncHandler(AiAdminController.saveKey));
router.delete("/keys/:provider", asyncHandler(AiAdminController.removeKey));

module.exports = router;
