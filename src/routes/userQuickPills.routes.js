const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const pool = require("../databases");
const { QUICK_PILL_KEYS, QUICK_PILL_MAX, normalizeQuickPills } = require("../utils/quickPills");

/**
 * GET/PUT /users/me/quick-pills — os pills do acesso rápido do perfil (mig 260).
 *
 * `pills: null` quer dizer "nunca escolheu" e o front mostra a pilha padrão;
 * `[]` é escolha ("nenhum"). Ver `utils/quickPills.js`.
 */
const router = Router();
router.use(authMiddleware);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT quick_pills FROM public.tb_user WHERE id_user = $1",
      [req.user.id_user]
    );
    return res.json({
      pills: rows[0]?.quick_pills ?? null,
      available: QUICK_PILL_KEYS,
      max: QUICK_PILL_MAX,
    });
  })
);

router.put(
  "/",
  asyncHandler(async (req, res) => {
    const pills = normalizeQuickPills(req.body?.pills);
    if (pills === null) {
      return res.status(400).json({ error: "Envie a lista de pills em `pills`." });
    }
    await pool.query("UPDATE public.tb_user SET quick_pills = $2 WHERE id_user = $1", [
      req.user.id_user,
      pills,
    ]);
    return res.json({ pills, available: QUICK_PILL_KEYS, max: QUICK_PILL_MAX });
  })
);

module.exports = router;
