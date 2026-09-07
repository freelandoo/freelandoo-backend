const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const PlanController = require("../controllers/PlanController");
const asyncHandler = require("../utils/asyncHandler");

// Planos mensais (mig 225), base `/plans`.
//
// ─── ORDEM: LITERAL ANTES DE PARÂMETRO ──────────────────────────────────────
//
// `/mine` vem ANTES de `/:slug`. Declarada depois, a rota com parâmetro
// engoliria a literal e "mine" viraria um slug de plano inexistente — 404 que
// manda procurar no lugar errado. Mesma disciplina de `/bees/timeline`.
const router = Router();

/**
 * Vitrine. FORA da flag e com auth opcional: o preço do plano é informação de
 * venda, e escondê-la de quem ainda não entrou seria fechar a porta na cara do
 * cliente novo. O que a sessão acrescenta é só saber se ELE já assina.
 */
router.get("/", optionalAuthMiddleware, asyncHandler(PlanController.list));

router.get("/mine", authMiddleware, asyncHandler(PlanController.mine));

/**
 * Cancelar NÃO passa por flag nenhuma: mesmo com a venda desligada, quem
 * assina precisa continuar podendo sair. Porta de saída trancada é a única que
 * não pode existir (regra das migs 220/223).
 */
router.delete("/mine", authMiddleware, asyncHandler(PlanController.cancel));

router.post("/:slug/checkout", authMiddleware, asyncHandler(PlanController.createCheckout));

module.exports = router;
