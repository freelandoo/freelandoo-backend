const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const ResidenceController = require("../controllers/ResidenceController");
const asyncHandler = require("../utils/asyncHandler");

// Residência é dado sensível: NENHUMA rota aqui é pública, nem com
// optionalAuth. Endereço não aparece para anônimo em hipótese nenhuma — é o
// que o §11 do desenho chama de "enumerar endereços", e a porta é fechada aqui,
// não em cada handler.
const router = Router();

router.use(authMiddleware);

/* -------------------------- fila do admin (antes) ------------------------- */
// ANTES das rotas com :id_residence, senão "proofs" seria capturado como id.
// E o comprovante é lido pelo ADMIN DA PLATAFORMA, nunca pelo gestor local
// (D13): o gestor de bairro é um vizinho.
router.get(
  "/proofs",
  roleMiddleware("Administrator"),
  asyncHandler(ResidenceController.listProofQueue)
);
router.post(
  "/proofs/:id_proof/decide",
  roleMiddleware("Administrator"),
  asyncHandler(ResidenceController.decideProof)
);

/* -------------------------------- morador --------------------------------- */
router.post("/claim", asyncHandler(ResidenceController.claim));
router.get("/mine", asyncHandler(ResidenceController.listMine));
router.get("/pending", asyncHandler(ResidenceController.listPending));
router.get("/units/:id_unit/neighbors", asyncHandler(ResidenceController.listNeighbors));

router.post("/:id_residence/recognize", asyncHandler(ResidenceController.recognize));
router.post("/:id_residence/contest", asyncHandler(ResidenceController.contest));
router.post("/:id_residence/proof", asyncHandler(ResidenceController.submitProof));
router.delete("/:id_residence", asyncHandler(ResidenceController.leave));

module.exports = router;
