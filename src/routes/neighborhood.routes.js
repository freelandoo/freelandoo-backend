const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const NeighborhoodController = require("../controllers/NeighborhoodController");
const asyncHandler = require("../utils/asyncHandler");

// Tudo exige login. A descoberta por (cidade, bairro) é aberta a QUALQUER
// logado de propósito — é assim que a pessoa acha o bairro onde acabou de se
// mudar. O que ela vê é só nome/cidade/UF: sem contagem de moradores, sem
// atividade, sem endereço (D5 + §11). Busca por rua não existe aqui.
const router = Router();

router.use(authMiddleware, requireFeature("bairro"));

// `/mine` e `/discover` ANTES de qualquer rota com :id_profile.
router.get("/mine", asyncHandler(NeighborhoodController.mine));
router.get("/discover", asyncHandler(NeighborhoodController.discover));
router.post("/", asyncHandler(NeighborhoodController.create));
router.post("/:id_profile/join", asyncHandler(NeighborhoodController.join));

module.exports = router;
