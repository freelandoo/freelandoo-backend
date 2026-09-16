// src/routes/communityCommerceAdmin.routes.js
// O painel do COMÉRCIO ENTRE VIZINHOS: a tabela de preços do delivery (mig
// 248), a régua da venda na vitrine (mig 249) e a fila de disputas.
//
// ⚠️ AS DUAS TABELAS DE PREÇO EXISTEM PARA SEREM EDITADAS AQUI, e é por isso
// que este arquivo não é opcional. A lição da mig 244: a taxa do agendamento
// era `PLATFORM_FEE_CENTS = 1000` no código enquanto a tela de admin escrevia
// noutro lugar — em produção havia 5% + R$2,50 configurados sem efeito nenhum.
// Tela morta é ruim; tela morta que MENTE é pior, porque a pessoa decide preço
// olhando para ela. Aqui a tela e o service leem a MESMA linha.
//
// ⚠️ A DISPUTA É JULGADA PELO ADMIN DA PLATAFORMA, não pelo síndico: ele é
// vizinho dos dois lados, e julgar o 302 contra o 501 é o tipo de poder que
// transforma o cargo num problema.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const CommunityCommerceAdminController = require("../controllers/CommunityCommerceAdminController");
const CommunityListingOrderController = require("../controllers/CommunityListingOrderController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Preços do delivery (os 4 tipos) e a régua da venda.
router.get("/settings", ...admin, asyncHandler(CommunityCommerceAdminController.getSettings));
router.put(
  "/delivery-types/:kind",
  ...admin,
  asyncHandler(CommunityCommerceAdminController.updateDeliveryType)
);
router.put(
  "/listing-settings",
  ...admin,
  asyncHandler(CommunityCommerceAdminController.updateListingSettings)
);

// A fila de disputas e o veredito.
router.get("/disputes", ...admin, asyncHandler(CommunityListingOrderController.listDisputes));
router.post(
  "/disputes/:id_dispute/decide",
  ...admin,
  asyncHandler(CommunityListingOrderController.decideDispute)
);

module.exports = router;
