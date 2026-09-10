// src/routes/platformAvatar.routes.js
//
// A foto de alguém DENTRO de uma plataforma (mig 233): games e Financeiro.
//
// ⚠️ A ROTA É `/me/...` porque a foto é DA PESSOA, e não da plataforma. Um
// `/games/avatar` diria que existe uma foto do ambiente — e a plataforma é uma
// linha só para o site inteiro (migs 229/232): a foto gravada nela seria a
// mesma para todos os visitantes, que é o oposto do pedido.
//
// ⚠️ APAGAR NÃO PASSA POR FLAG NENHUMA, pela regra de sempre: porta de saída
// trancada é a única que não pode existir. Se a plataforma for desligada no
// Painel de Controle, quem trocou a foto continua podendo voltar à sua.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const asyncHandler = require("../utils/asyncHandler");
const PlatformAvatarController = require("../controllers/PlatformAvatarController");

const router = Router();

router.get(
  "/me/platform-avatar/:kind",
  authMiddleware,
  asyncHandler(PlatformAvatarController.mine)
);

// `avatar` é o nome do campo do multipart — o mesmo do avatar de perfil, para
// não haver dois nomes para o mesmo tipo de envio.
router.put(
  "/me/platform-avatar/:kind",
  authMiddleware,
  uploadAvatar.single("avatar"),
  asyncHandler(PlatformAvatarController.upload)
);

router.delete(
  "/me/platform-avatar/:kind",
  authMiddleware,
  asyncHandler(PlatformAvatarController.reset)
);

module.exports = router;
