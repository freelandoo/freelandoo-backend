const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const resolveUserAccountProfile = require("../middlewares/resolveUserAccountProfile");
const SocialMediaService = require("../services/SocialMediaService");
const pool = require("../databases");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Redes sociais do USER ACCOUNT (perfil-fantasma is_user_account=TRUE) —
 * paridade user≡subperfil. Reaproveita o SocialMediaService por-perfil,
 * passando o id_profile do middleware (mesmo padrão do userAccountPortfolio).
 *
 * Aceita o body legado do /account: { platform, account, followers_range }
 * (nomes em texto) e resolve os ids no banco. `:id` das rotas de item é o
 * id_social_media_type (é o "id" devolvido em /users/me → redes_sociais).
 */
const router = Router();

router.use(authMiddleware);
router.use(resolveUserAccountProfile);

function buildUrl(platform, account) {
  const raw = String(account || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 500);
  const handle = raw.replace(/^@/, "");
  const p = String(platform || "").trim().toLowerCase();
  if (p === "instagram") return `https://instagram.com/${handle}`;
  if (p === "youtube") return `https://youtube.com/@${handle}`;
  if (p === "tiktok") return `https://tiktok.com/@${handle}`;
  return `https://${handle}`;
}

async function resolveTypeId(platform) {
  const p = String(platform || "").trim().toLowerCase();
  if (!p) return null;
  const r = await pool.query(
    `SELECT id_social_media_type
       FROM public.tb_social_media_type
      WHERE (lower(desc_social_media_type) = $1 OR lower(icon) = $1)
        AND is_active = TRUE
      LIMIT 1`,
    [p]
  );
  return r.rows[0]?.id_social_media_type ?? null;
}

async function resolveRangeId(label) {
  const l = String(label || "").trim();
  if (!l) return null;
  const r = await pool.query(
    `SELECT id_follower_range
       FROM public.tb_follower_range
      WHERE follower_range = $1
      LIMIT 1`,
    [l]
  );
  return r.rows[0]?.id_follower_range ?? null;
}

function reply(res, result, successStatus = 200) {
  if (result?.error) {
    const message = String(result.error).toLowerCase();
    if (message.includes("não autenticado")) return res.status(401).json(result);
    if (message.includes("não encontrado")) return res.status(404).json(result);
    if (message.includes("permissão")) return res.status(403).json(result);
    return res.status(400).json(result);
  }
  return res.status(successStatus).json(result);
}

// CREATE / UPSERT
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { platform, account, followers_range } = req.body || {};
    const id_social_media_type = await resolveTypeId(platform);
    if (!id_social_media_type) {
      return res.status(400).json({ error: "Rede social desconhecida" });
    }
    const url = buildUrl(platform, account);
    if (!url) return res.status(400).json({ error: "Conta/URL obrigatória" });
    const id_follower_range = await resolveRangeId(followers_range);

    const result = await SocialMediaService.upsert(
      req.user,
      { id_profile: req.userAccountProfileId },
      { id_social_media_type, url, id_follower_range }
    );
    return reply(res, result, 201);
  })
);

// UPDATE por tipo (id = id_social_media_type)
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { platform, account, followers_range } = req.body || {};
    const url = buildUrl(platform, account);
    if (!url) return res.status(400).json({ error: "Conta/URL obrigatória" });
    const id_follower_range = await resolveRangeId(followers_range);

    const result = await SocialMediaService.updateByType(
      req.user,
      {
        id_profile: req.userAccountProfileId,
        id_social_media_type: req.params.id,
      },
      { url, id_follower_range }
    );
    return reply(res, result);
  })
);

// DELETE (desativa) por tipo
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await SocialMediaService.disableByType(req.user, {
      id_profile: req.userAccountProfileId,
      id_social_media_type: req.params.id,
    });
    return reply(res, result);
  })
);

module.exports = router;
