const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const SubjectCommunityController = require("../controllers/SubjectCommunityController");
const asyncHandler = require("../utils/asyncHandler");

// Modalidades de comunidade com assunto próprio (mig 210): pet, carro e games.
//
// Montado na raiz (padrão do academy.routes) porque os três bases são curtos e
// independentes, e porque `/me/spaces` — o que alimenta o menu da foto de
// perfil — não pertence a nenhum deles: ele responde "o que é meu", incluindo
// condomínio, bairro, comunidade temática e academia.
//
// A flag é por MODALIDADE e fica em cada grupo, nunca no router inteiro:
// desligar o carro (que depende da FIPE) não pode derrubar o pet junto.
const router = Router();

// ─── Pet ──────────────────────────────────────────────────────────────────────
// O catálogo de raças é aberto a qualquer logado: é a lista que a tela de
// cadastro precisa antes de existir qualquer pet.
router.get(
  "/pets/breeds",
  authMiddleware,
  requireFeature("pet"),
  asyncHandler(SubjectCommunityController.listBreeds)
);
router.post(
  "/pets",
  authMiddleware,
  requireFeature("pet"),
  asyncHandler(SubjectCommunityController.createPet)
);

// ─── Carro ────────────────────────────────────────────────────────────────────
// `/cars/brands` antes de qualquer rota com parâmetro — a ordem aqui é a mesma
// disciplina que o `/bees/timeline` exigiu: rota literal primeiro, senão o
// parâmetro a engole.
router.get(
  "/cars/brands",
  authMiddleware,
  requireFeature("carro"),
  asyncHandler(SubjectCommunityController.listCarBrands)
);
router.get(
  "/cars/brands/:brand_code/models",
  authMiddleware,
  requireFeature("carro"),
  asyncHandler(SubjectCommunityController.listCarModels)
);
router.post(
  "/cars",
  authMiddleware,
  requireFeature("carro"),
  asyncHandler(SubjectCommunityController.createOrJoinCar)
);

// ─── Games ────────────────────────────────────────────────────────────────────
router.post(
  "/games",
  authMiddleware,
  requireFeature("games"),
  asyncHandler(SubjectCommunityController.createGame)
);

// ─── Meus espaços ─────────────────────────────────────────────────────────────
// SEM requireFeature: o menu mostra o que a pessoa já tem. Se o carro for
// desligado no Painel de Controle, a comunidade que ela fundou não desaparece
// do menu dela — o que a flag esconde é a CRIAÇÃO.
router.get(
  "/me/spaces",
  authMiddleware,
  asyncHandler(SubjectCommunityController.mySpaces)
);

module.exports = router;
