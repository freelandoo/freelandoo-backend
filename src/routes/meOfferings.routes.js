const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const MeOfferingsController = require("../controllers/MeOfferingsController");

const router = Router();

// Lista agregada do que o usuário pode "puxar" pra dentro de um chat
// (O.S. / mensagens privadas). Retorna products, services e courses do
// próprio user em todos os subperfis, com URL pública pronta.
router.get("/offerings", authMiddleware, asyncHandler(MeOfferingsController.list));

module.exports = router;
