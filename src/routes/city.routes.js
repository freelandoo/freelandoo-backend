const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CityService = require("../services/CityService");
const asyncHandler = require("../utils/asyncHandler");
const { sendServiceResult } = require("../utils/sendServiceResult");

// Minha cidade (mig 468). Montado na raiz porque é `/me/...` — a preferência é
// da PESSOA, como `/me/spaces`.
//
// SEM requireFeature, de propósito: o ambiente serve bairro (flag `bairro`) e
// condomínio (flag `condominio`), e desligar um não pode fechar o outro — nem
// esconder de quem tem pedido em aberto o caminho até a comunidade antiga.
// Cada aba respeita a flag da sua modalidade nas rotas dela.
const router = Router();

router.get(
  "/me/city",
  authMiddleware,
  asyncHandler(async (req, res) => sendServiceResult(res, await CityService.getMine(req.user)))
);

router.put(
  "/me/city",
  authMiddleware,
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await CityService.setMine(req.user, req.body || {}))
  )
);

module.exports = router;
