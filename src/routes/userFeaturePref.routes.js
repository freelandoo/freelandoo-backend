const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const pool = require("../databases");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Preferências de funções POR USUÁRIO (mig 186) — seção "Funções" do menu
 * lateral. Preferência de UI: esconde os pontos de entrada da função no front
 * do próprio usuário. NÃO é o Painel de Controle do admin (tb_feature_flag):
 * a flag global desligada vence a preferência pessoal.
 *
 * Whitelist fechada (utils/userFeatureKeys) — chave fora dela é 400.
 *
 * Loja de Funções (mig 191): o GET também devolve o mapa `owned` — função à
 * venda que o usuário NÃO comprou vem owned=false e o front esconde a linha
 * do menu e os pontos de entrada. Produto is_for_sale=FALSE = função grátis.
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
    const r = await pool.query(
      `SELECT feature_key, is_enabled
         FROM public.tb_user_feature_pref
        WHERE id_user = $1`,
      [req.user.id_user]
    );
    const features = {};
    for (const key of USER_FEATURE_KEYS) features[key] = true;
    for (const row of r.rows) {
      if (USER_FEATURE_KEYS.includes(row.feature_key)) {
        features[row.feature_key] = row.is_enabled !== false;
      }
    }
    const owned = await FunctionStoreService.ownershipMap(req.user.id_user);
    return res.json({ features, owned });
  })
);

// PUT /users/me/features/:key { enabled: bool } → upsert
router.put(
  "/:key",
  asyncHandler(async (req, res) => {
    const key = String(req.params.key || "").trim();
    if (!USER_FEATURE_KEYS.includes(key)) {
      return res.status(400).json({ error: "Função desconhecida" });
    }
    const enabled = req.body?.enabled !== false;
    await pool.query(
      `INSERT INTO public.tb_user_feature_pref (id_user, feature_key, is_enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id_user, feature_key)
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW()`,
      [req.user.id_user, key, enabled]
    );
    return res.json({ feature_key: key, enabled });
  })
);

module.exports = router;
