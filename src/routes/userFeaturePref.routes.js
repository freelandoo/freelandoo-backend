const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Funções POR USUÁRIO — hoje só LEITURA da posse.
 *
 * A preferência pessoal da mig 186 (o liga/desliga da seção "Funções" do menu
 * lateral) FOI DESCONTINUADA na mig 218: função de usuário é sempre ligada.
 * Ela era o segundo gate de `useUserFeature` (= posse && preferência) e
 * escondia pontos de entrada sem erro nenhum — foi ela que, junto do gate da
 * Loja de Funções, sumiu com o pill de Fitness do headcard.
 *
 * O que decide o acesso continua sendo:
 *   - POSSE (Loja de Funções, mig 191) → mapa `owned` deste GET;
 *   - flag global do admin (tb_feature_flag) → outro endpoint, vence tudo.
 *
 * `features` continua no corpo da resposta, com TODAS as chaves em `true`, só
 * para não quebrar client antigo em cache que ainda lê esse mapa.
 */
const { USER_FEATURE_KEYS } = require("../utils/userFeatureKeys");

const router = Router();

router.use(authMiddleware);

// GET /users/me/features → { features: { key: bool }, owned: { key: bool } }
// (sem linha de pref = true; owned=false quando a função está à venda e o
// usuário ainda não comprou — o front esconde a linha e os pontos de entrada)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const FunctionStoreService = require("../services/FunctionStoreService");
    // A tabela de preferências NÃO é mais lida: toda função é ligada (mig 218).
    // Ler linhas antigas aqui faria um `FALSE` esquecido continuar escondendo
    // a função de alguém, que é exatamente o que esta mudança acaba.
    const features = {};
    for (const key of USER_FEATURE_KEYS) features[key] = true;
    const owned = await FunctionStoreService.ownershipMap(req.user.id_user);
    return res.json({ features, owned });
  })
);

// PUT /users/me/features/:key — DESCONTINUADO (mig 218).
//
// Responde 410 em vez de sumir: o front novo não tem mais o switch, mas JS em
// cache de sessão aberta ainda chama este PUT ao clicar no botão antigo. Um 404
// mudo viraria ruído sem explicação no log; o 410 diz o que aconteceu. O client
// antigo aplica o estado local otimista e o próximo GET (tudo `true`) o corrige
// sozinho — ninguém fica com função escondida.
//
// É AQUI que "não dá mais para deixar false" se torna verdade: sem esta escrita,
// nenhum caminho da aplicação grava FALSE na tb_user_feature_pref.
router.put(
  "/:key",
  asyncHandler(async (req, res) =>
    res.status(410).json({
      error: "As funções da conta são sempre ativas — não é mais possível desligá-las.",
    })
  )
);

module.exports = router;
