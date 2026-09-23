// src/routes/prospectAdmin.routes.js
// A porta de SUPRESSÃO da base de empresas (LGPD), montada em
// `/admin/prospeccao`.
//
// ⚠️ ELA NÃO É DO DONO DO NEGÓCIO, E ISSO É DECISÃO. Quem pede para sair da
// base é a EMPRESA — por e-mail, por canal jurídico —, não um usuário da
// Freelandoo. Dar este botão ao líder de um negócio o transformaria numa forma
// de apagar o concorrente da base de todo mundo, com o nome da plataforma em
// cima.
//
// ⚠️ SOB `/admin` também pelo motivo operacional de sempre: é o prefixo que o
// audit log estruturado do `app.js` já cobre inteiro.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const ProspectController = require("../controllers/ProspectController");

const router = Router();

// Sem `requireFeature` de propósito: a flag é o kill-switch do PRODUTO. Desligá-la
// para segurar um problema na prospecção não pode impedir a plataforma de
// atender um pedido de remoção — porta de saída trancada é a única que nunca
// pode existir (mesma regra do despublicar e do desconectar do WhatsApp).
router.post(
  "/suppress",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ProspectController.suppress)
);

module.exports = router;
