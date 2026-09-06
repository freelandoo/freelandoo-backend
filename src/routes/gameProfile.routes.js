const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const GameProfileController = require("../controllers/GameProfileController");
const asyncHandler = require("../utils/asyncHandler");

// Perfil gamer (mig 220): a conta de plataforma conectada, a estante e a
// comparação.
//
// ─── POR QUE `/gamer` E NÃO `/games` ─────────────────────────────────────────
//
// `/games` já é da COMUNIDADE de games (mig 210): `POST /games` cria o espaço e
// `PATCH /games/:id_profile` edita o assunto dele. São coisas diferentes —
// aquilo é um espaço social sobre UM jogo; isto é a biblioteca da PESSOA — e
// misturá-las num prefixo só entregaria dois problemas: `/games/:id_profile`
// disputando caminho com `/games/:provider/...`, e a leitura errada de que
// conectar a Steam é uma operação da comunidade.
//
// ─── ORDEM: LITERAL ANTES DE PARÂMETRO ───────────────────────────────────────
//
// `providers`, `shelf` e `compare` vêm ANTES de `:provider`. É a mesma
// disciplina que `/bees/timeline` exigiu: declarada depois, a rota com
// parâmetro engole a literal e o erro aparece como "rota inexistente".
const router = Router();

// ─── Literais ────────────────────────────────────────────────────────────────
router.get(
  "/gamer/providers",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.listProviders)
);

router.get(
  "/gamer/shelf",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.myShelf)
);

router.get(
  "/gamer/shelf/:id_user",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.userShelf)
);

router.get(
  "/gamer/compare/:username",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.compare)
);

// ─── Conexão ─────────────────────────────────────────────────────────────────
router.get(
  "/gamer/:provider/connect",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.startConnect)
);

/**
 * ⚠️ SEM authMiddleware E SEM requireFeature, as duas coisas de propósito.
 *
 * Quem chega aqui é o NAVEGADOR voltando da Steam, mandado por ela: não existe
 * Authorization nessa viagem, e quem prova de quem é o pedido é o `state`
 * assinado que o service confere. Um authMiddleware aqui recusaria toda
 * conexão, sempre.
 *
 * E o gate da flag fica de fora porque desligar a feature no meio da ida e
 * volta (uma janela de 10 minutos) deixaria a pessoa parada num JSON de 403 no
 * domínio do backend, sem caminho de volta — e por uma conexão que ela já
 * autorizou do outro lado.
 */
router.get(
  "/gamer/:provider/callback",
  asyncHandler(GameProfileController.finishConnect)
);

router.post(
  "/gamer/:provider/sync",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.syncNow)
);

router.patch(
  "/gamer/:provider/visibility",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.setVisibility)
);

/**
 * Desconectar NÃO passa pela flag: se o Painel de Controle desligar a feature,
 * quem já conectou tem que continuar podendo desligar e apagar o que trouxe.
 * Uma porta de saída trancada é a única que não pode existir.
 */
router.delete(
  "/gamer/:provider",
  authMiddleware,
  asyncHandler(GameProfileController.disconnect)
);

// Conquistas de UM jogo (a única leitura que gasta chamada por jogo — cache de
// 24h no service). `?id_user=` compara a estante de outra pessoa.
router.get(
  "/gamer/:provider/achievements/:id_game",
  authMiddleware,
  requireFeature("games_conexao"),
  asyncHandler(GameProfileController.achievements)
);

module.exports = router;
