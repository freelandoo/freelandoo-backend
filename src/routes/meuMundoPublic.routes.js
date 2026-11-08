// src/routes/meuMundoPublic.routes.js
//
// MEU MUNDO 3D — o que é PÚBLICO (sem login). B3 (2026-11-08): o certificado de cada
// personagem, por link (código aleatório de 12 caracteres, não o número de série — o
// número não deixa listar todos). Projeção campo a campo em MeuMundoCharacterService:
// nada do dono além do apelido do jogo.

const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const MeuMundoController = require("../controllers/MeuMundoController");

const router = Router();

router.get("/certificado/:code", asyncHandler(MeuMundoController.certificate));

module.exports = router;
