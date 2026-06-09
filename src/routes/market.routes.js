const { Router } = require("express");
const MarketController = require("../controllers/MarketController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Público (sem auth): o widget aparece pra qualquer user logado, e o conteúdo
// não é sensível. O front cacheia via ISR pra não bater aqui a cada request.
router.get("/market/snapshot", asyncHandler(MarketController.snapshot));

module.exports = router;
