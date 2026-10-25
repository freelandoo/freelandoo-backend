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
// sala multiplayer. mm3d-09: o ambiente pode ser a RUA ou o INTERIOR de uma
// casa; entrar, sair e visitar passam por aqui (o servidor confere posição,
// propriedade e convite — o navegador nunca escolhe a sala).

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const MeuMundoController = require("../controllers/MeuMundoController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/neighborhood", ...admin, asyncHandler(MeuMundoController.adminNeighborhood));
router.post("/session", ...admin, asyncHandler(MeuMundoController.adminSession));
// Troca o nível da PRÓPRIA casa (teste). Dono = residência ativa do token.
router.post("/house/level", ...admin, asyncHandler(MeuMundoController.adminHouseLevel));
// Entrar (lote no bairro em que você está) e sair pela porta.
router.post("/house/enter", ...admin, asyncHandler(MeuMundoController.houseEnter));
router.post("/house/exit", ...admin, asyncHandler(MeuMundoController.houseExit));
// Centro da cidade (mm3d-17): ir e voltar para casa (o bairro de casa é o da residência do token).
router.post("/center/enter", ...admin, asyncHandler(MeuMundoController.centerEnter));
router.post("/center/leave", ...admin, asyncHandler(MeuMundoController.centerLeave));
// Jetpack em grupo (mm3d-21): sala do centro em que você está, perto da porta.
router.post("/center/jetpack", ...admin, asyncHandler(MeuMundoController.jetpackJoin));
// Convites e visitas (mig 293).
router.get("/visits", ...admin, asyncHandler(MeuMundoController.visits));
router.get("/visits/candidates", ...admin, asyncHandler(MeuMundoController.candidates));
router.post("/visits", ...admin, asyncHandler(MeuMundoController.invite));
router.post("/visits/:id/accept", ...admin, asyncHandler(MeuMundoController.accept));
router.post("/visits/:id/decline", ...admin, asyncHandler(MeuMundoController.decline));
router.post("/visits/:id/cancel", ...admin, asyncHandler(MeuMundoController.cancel));
router.post("/visits/:id/end", ...admin, asyncHandler(MeuMundoController.endVisit));
// Vida do hóspede (mig 295): estado, atividade com horas, comer/tomar, novo hóspede.
router.get("/life", ...admin, asyncHandler(MeuMundoController.life));
// Hospital do centro (mm3d-26): planta por dentro + leito + régua da alta.
router.get("/hospital", ...admin, asyncHandler(MeuMundoController.hospital));
router.post("/life/activity", ...admin, asyncHandler(MeuMundoController.lifeActivity));
router.post("/life/consume", ...admin, asyncHandler(MeuMundoController.lifeConsume));
// Mercado → geladeira (mig 301). Comer da geladeira é pela sala da casa (mensagem "fridge").
router.post("/life/buy", ...admin, asyncHandler(MeuMundoController.lifeBuy));
router.post("/life/newcomer", ...admin, asyncHandler(MeuMundoController.lifeNewcomer));
// Vestuário (mig 300): catálogo de skins, comprar (moedas do jogo) e vestir.
router.get("/skins", ...admin, asyncHandler(MeuMundoController.skins));
router.post("/skins/:id/buy", ...admin, asyncHandler(MeuMundoController.skinBuy));
router.post("/skins/:id/equip", ...admin, asyncHandler(MeuMundoController.skinEquip));
router.get("/status", ...admin, asyncHandler(MeuMundoController.adminStatus));

module.exports = router;
