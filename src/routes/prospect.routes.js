// src/routes/prospect.routes.js
// A prospecção do negócio (mig 254), montada em `/communities/:id_profile/leads`.
//
// ⚠️ O ENDEREÇO É SOB `/communities` DE PROPÓSITO, E ISSO ECONOMIZOU UM ARQUIVO
// INTEIRO NO FRONT: já existe um proxy catch-all `/api/communities/[...path]`
// na Vercel. Uma base própria (`/prospect`, `/leads`) obrigaria a escrever um
// segundo proxy com a mesma lógica de encaminhamento — e seria ele que ficaria
// para trás no dia em que o primeiro ganhasse um cabeçalho novo.
//
// ⚠️ E ELE NÃO DISPUTA ROTA COM A COMUNIDADE. `communityPublic.routes` tem
// `GET /:id_profile`, que casa UM segmento; tudo aqui tem pelo menos três
// (`/:id_profile/leads/...`). Ainda assim, este router é montado ANTES da
// pública no `routes/index.js`, porque ordem explícita é mais barata que
// confiar na contagem de segmentos de outra pessoa.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");
const ProspectController = require("../controllers/ProspectController");

const router = Router();

// ⚠️ TUDO AUTENTICADO E ATRÁS DA FLAG. A base de empresas é o ativo do
// subsistema: uma porta anônima aqui seria a base inteira exportável por quem
// souber a URL. Quem decide QUEM dentro da conta é o `_assertBusiness` do
// service (líder do negócio), num lugar só.
router.use("/:id_profile/leads", authMiddleware, requireFeature("prospeccao"));

router.get("/:id_profile/leads/catalog", asyncHandler(ProspectController.catalog));
router.get("/:id_profile/leads/search", asyncHandler(ProspectController.search));
router.get("/:id_profile/leads/jobs", asyncHandler(ProspectController.jobs));
router.post("/:id_profile/leads/discover", asyncHandler(ProspectController.discover));

router.get("/:id_profile/leads/companies/:id_company", asyncHandler(ProspectController.getCompany));
router.post(
  "/:id_profile/leads/companies/:id_company/enrich",
  asyncHandler(ProspectController.enrich)
);

// ⚠️ `/lists` ANTES de `/companies/:id_company` não é necessário (os prefixos
// são distintos), mas as rotas de item de lista PRECISAM vir depois da coleção
// — `/lists/:id_list` casaria com `/lists` se a ordem fosse invertida e o
// Express não distinguisse a contagem de segmentos.
router.get("/:id_profile/leads/lists", asyncHandler(ProspectController.listLists));
router.post("/:id_profile/leads/lists", asyncHandler(ProspectController.createList));
router.patch("/:id_profile/leads/lists/:id_list", asyncHandler(ProspectController.updateList));
router.delete("/:id_profile/leads/lists/:id_list", asyncHandler(ProspectController.removeList));

router.get(
  "/:id_profile/leads/lists/:id_list/companies",
  asyncHandler(ProspectController.listCompanies)
);
router.post(
  "/:id_profile/leads/lists/:id_list/companies",
  asyncHandler(ProspectController.addToList)
);
router.delete(
  "/:id_profile/leads/lists/:id_list/companies/:id_company",
  asyncHandler(ProspectController.removeFromList)
);
router.patch(
  "/:id_profile/leads/lists/:id_list/companies/:id_company",
  asyncHandler(ProspectController.setStage)
);

module.exports = router;
