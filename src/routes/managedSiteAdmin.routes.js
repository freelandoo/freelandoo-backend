// Site feito pela Freelandoo (mig 241) — a porta da PLATAFORMA.
//
// ⚠️ TODAS as rotas vivem sob `roleMiddleware("Administrator")`, e é isso que
// torna verdade a frase "ninguém além da gente coloca site aqui". Não existe
// versão destas rotas para o líder da comunidade: o que ele pode fazer com o
// site dele já está em `/communities/:id/site`, e lá o guard recusa mexer num
// site gerenciado.
//
// Sem `requireFeature("comunidade_site")`: aquela flag é o kill-switch do
// CONSTRUTOR (a superfície do cliente). Desligá-la um dia para segurar um
// problema no construtor não pode nos impedir de manter no ar os sites que já
// vendemos.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const ManagedSiteController = require("../controllers/ManagedSiteController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// `/templates` ANTES de `/:id_profile` — na ordem inversa, o parâmetro
// engoliria a palavra e pedir a lista de temas viraria a busca por uma
// comunidade chamada "templates". Mesma armadilha de `/live-clusters/mine`.
router.get("/templates", ...admin, asyncHandler(ManagedSiteController.listTemplates));

router.get("/", ...admin, asyncHandler(ManagedSiteController.list));
router.get("/:id_profile", ...admin, asyncHandler(ManagedSiteController.get));
// Converte o site do construtor neste tema e DEVOLVE, sem gravar.
router.get(
  "/:id_profile/from-canvas",
  ...admin,
  asyncHandler(ManagedSiteController.draftFromCanvas)
);
router.put("/:id_profile", ...admin, asyncHandler(ManagedSiteController.apply));
router.post("/:id_profile/publish", ...admin, asyncHandler(ManagedSiteController.setPublished));
router.delete("/:id_profile", ...admin, asyncHandler(ManagedSiteController.release));

module.exports = router;
