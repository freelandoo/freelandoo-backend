// src/routes/meuMundoAdmin.routes.js
//
// MEU MUNDO 3D — área administrativa (em desenvolvimento).
//
// Só Administrator. O cliente do jogo só é carregado DEPOIS que esta rota
// responde, então quem não é admin não recebe nem o bairro nem o motor 3D,
// mesmo entrando pela URL. Sem requireFeature: não há flag do Meu Mundo
// (a antiga saiu com o jogo anterior), e o acesso público segue fechado.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const MeuMundoController = require("../controllers/MeuMundoController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/neighborhood", ...admin, asyncHandler(MeuMundoController.adminNeighborhood));

module.exports = router;
