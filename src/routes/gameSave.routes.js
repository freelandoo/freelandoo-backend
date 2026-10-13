// src/routes/gameSave.routes.js — saves do EVO Brazil na conta (mig 279).
//
// Chamadas pelo jogo: no /jogar ele é da MESMA origem do site (o CORS de
// sempre vale), no app nativo não há CORS. Gravar é manual (botão SALVAR),
// então o limite `lookup` (20/min) sobra.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");
const GameSaveService = require("../services/GameSaveService");
const { sendServiceResult } = require("../utils/sendServiceResult");

const router = Router();

router.get("/me/game-saves", authMiddleware, asyncHandler(async (req, res) =>
  sendServiceResult(res, await GameSaveService.list(req.user.id_user))));
router.get("/me/game-saves/:slot", authMiddleware, asyncHandler(async (req, res) =>
  sendServiceResult(res, await GameSaveService.get(req.user.id_user, req.params.slot))));
router.put("/me/game-saves/:slot", authMiddleware, rateLimit.lookup, asyncHandler(async (req, res) =>
  sendServiceResult(res, await GameSaveService.put(req.user.id_user, req.params.slot, req.body))));
router.delete("/me/game-saves/:slot", authMiddleware, asyncHandler(async (req, res) =>
  sendServiceResult(res, await GameSaveService.remove(req.user.id_user, req.params.slot))));

module.exports = router;
