// src/routes/meuMundoAdmin.routes.js
//
// MEU MUNDO 3D — área administrativa (em desenvolvimento).
//
// Só Administrator. O cliente do jogo só é carregado DEPOIS que esta rota
// responde, então quem não é admin não recebe nem o bairro nem o motor 3D,
// mesmo entrando pela URL. Sem requireFeature: não há flag do Meu Mundo
// (a antiga saiu com o jogo anterior), e o acesso público segue fechado.
//
// mm3d-02: o bairro é PERSISTENTE (mig 291) e a resposta traz a reserva da
// sala multiplayer do bairro do usuário (src/realtime/meuMundo.js).

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const MeuMundoController = require("../controllers/MeuMundoController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/neighborhood", ...admin, asyncHandler(MeuMundoController.adminNeighborhood));
router.post("/session", ...admin, asyncHandler(MeuMundoController.adminSession));
router.get("/status", ...admin, asyncHandler(MeuMundoController.adminStatus));

module.exports = router;
