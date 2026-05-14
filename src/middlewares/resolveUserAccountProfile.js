const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");

/**
 * Injeta `req.userAccountProfileId` E `req.params.id_profile` apontando para
 * o perfil-fantasma (is_user_account=TRUE) do usuário autenticado. Cria sob
 * demanda caso ainda não exista (fallback do backfill da migration 052).
 *
 * Deve rodar APÓS `authMiddleware`.
 */
async function resolveUserAccountProfile(req, res, next) {
  try {
    const id_user = req.user?.id_user;
    if (!id_user) return res.status(401).json({ error: "Não autenticado" });

    const id_profile = await ProfileStorage.getUserAccountProfileId(pool, id_user);
    if (!id_profile) {
      console.error("[resolveUserAccountProfile] sem id_profile para id_user", id_user);
      return res.status(500).json({
        error: "Não foi possível resolver o perfil do usuário (user-account profile não existe)",
      });
    }

    // Express 5 — req.params pode ter problemas de mutação em routes sem :param.
    // Setamos em ambos os lugares para ser defensivo: req.params + req.userAccountProfileId.
    if (!req.params) req.params = {};
    req.params.id_profile = id_profile;
    req.userAccountProfileId = id_profile;
    next();
  } catch (err) {
    console.error("[resolveUserAccountProfile] erro", err);
    next(err);
  }
}

module.exports = resolveUserAccountProfile;
