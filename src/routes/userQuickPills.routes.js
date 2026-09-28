const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const pool = require("../databases");
const {
  QUICK_PILL_KEYS,
  QUICK_PILL_MAX,
  normalizeQuickPills,
  PUBLIC_PILL_KEYS,
  normalizePublicPills,
  resolvePublicPills,
} = require("../utils/quickPills");

/**
 * GET/PUT /users/me/quick-pills — os pills do acesso rápido do perfil (mig 260).
 *
 * `pills: null` quer dizer "nunca escolheu" e o front mostra a pilha padrão;
 * `[]` é escolha ("nenhum"). Ver `utils/quickPills.js`.
 *
 * `public_pills` (mig 270) é o OLHO: o que o visitante vê. Sempre devolvido
 * RESOLVIDO (padrão = só business), porque a tela desenha o estado do olho e
 * não tem o que fazer com "nunca escolheu". O PUT aceita os dois campos de
 * forma independente — mandar só um não mexe no outro.
 */
const router = Router();
router.use(authMiddleware);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT quick_pills, public_pills FROM public.tb_user WHERE id_user = $1",
      [req.user.id_user]
    );
    return res.json({
      pills: rows[0]?.quick_pills ?? null,
      public_pills: resolvePublicPills(rows[0]?.public_pills),
      available: QUICK_PILL_KEYS,
      public_available: PUBLIC_PILL_KEYS,
      max: QUICK_PILL_MAX,
    });
  })
);

router.put(
  "/",
  asyncHandler(async (req, res) => {
    const hasPills = req.body?.pills !== undefined;
    const hasPublic = req.body?.public_pills !== undefined;
    const pills = hasPills ? normalizeQuickPills(req.body.pills) : null;
    const publicPills = hasPublic ? normalizePublicPills(req.body.public_pills) : null;
    if ((!hasPills && !hasPublic) || (hasPills && pills === null) || (hasPublic && publicPills === null)) {
      return res
        .status(400)
        .json({ error: "Envie a lista de pills em `pills` e/ou `public_pills`." });
    }
    // Cada campo só é reescrito quando veio no corpo.
    const { rows } = await pool.query(
      `UPDATE public.tb_user
          SET quick_pills  = CASE WHEN $2::boolean THEN $3::text[] ELSE quick_pills END,
              public_pills = CASE WHEN $4::boolean THEN $5::text[] ELSE public_pills END
        WHERE id_user = $1
        RETURNING quick_pills, public_pills`,
      [req.user.id_user, hasPills, pills, hasPublic, publicPills]
    );
    return res.json({
      pills: rows[0]?.quick_pills ?? null,
      public_pills: resolvePublicPills(rows[0]?.public_pills),
      available: QUICK_PILL_KEYS,
      public_available: PUBLIC_PILL_KEYS,
      max: QUICK_PILL_MAX,
    });
  })
);

module.exports = router;
