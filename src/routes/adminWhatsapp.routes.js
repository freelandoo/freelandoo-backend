const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const AdminWhatsappController = require("../controllers/AdminWhatsappController");

// Painel de qualidade dos números do portfólio (W6), base `/admin/whatsapp`.
//
// ⚠️ SEM `requireFeature("whatsapp_atendimento")`, de propósito, e pela mesma
// razão das rotas de `/admin/managed-sites`: aquela flag é o kill-switch do
// produto para o USUÁRIO. Desligá-la para segurar um problema não pode cegar
// quem administra justamente no momento em que há um problema para olhar — e é
// nesse momento que este painel serve para alguma coisa.
const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/numbers", ...admin, asyncHandler(AdminWhatsappController.listNumbers));

// Desligar o número de outra pessoa. Fica atrás do mesmo guard de admin: é a
// única porta da plataforma que tira do ar um canal que não é de quem clicou.
router.delete(
  "/numbers/:id_instance",
  ...admin,
  asyncHandler(AdminWhatsappController.disconnectNumber)
);

module.exports = router;
