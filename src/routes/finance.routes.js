// src/routes/finance.routes.js
//
// A plataforma Financeiro (mig 229).
//
// ⚠️ POUCAS ROTAS, e de propósito: o que esta base faz é dizer QUAL é o espaço
// financeiro, ordenar a fila dele e receber a batida de presença. Feed,
// publicação, curtida e comentário continuam sendo
// `/communities/:id_profile/...`, porque o Financeiro É uma comunidade — a
// diferença é que existe uma só e ninguém entra nela.
//
// `authMiddleware` e não opcional: a Carteira inteira é área logada, e a rota
// pode CRIAR a linha na primeira visita (get-or-create). Deixar visitante
// anônimo escrever no banco, ainda que de forma idempotente, é porta aberta
// sem necessidade.

const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const FinanceController = require("../controllers/FinanceController");

const router = express.Router();

router.get("/", authMiddleware, asyncHandler(FinanceController.getPlatform));

// A fila da plataforma, por cidade ou estado (`?scope=city|state`). Mesma conta
// do ranking de games — o storage e os pesos são compartilhados.
router.get("/ranking", authMiddleware, asyncHandler(FinanceController.ranking));

// A batida de presença (mig 230). POST porque ESCREVE (credita segundos).
//
// ⚠️ Chamada DIRETO no Railway pelo navegador, nunca pelo proxy `/api/*` da
// Vercel: é recorrente (a cada 2 min de cada pessoa com a Carteira aberta) e
// cada passagem pelo proxy cobraria uma invocação por batida. Mesma regra do
// heartbeat de XP, do chat e da batida de games.
router.post("/presence", authMiddleware, asyncHandler(FinanceController.presenceBeat));

module.exports = router;
