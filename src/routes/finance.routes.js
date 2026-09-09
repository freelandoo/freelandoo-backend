// src/routes/finance.routes.js
//
// A plataforma Financeiro (mig 229).
//
// ⚠️ UMA ROTA SÓ, e de propósito: o que esta base faz é dizer QUAL é o espaço
// financeiro. Feed, publicação, curtida e comentário continuam sendo
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

module.exports = router;
