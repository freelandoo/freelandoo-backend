const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");

/**
 * Injeta `req.params.id_profile` apontando para o perfil-fantasma
 * (is_user_account=TRUE) do usuário autenticado. Cria sob demanda
 * caso ainda não exista (fallback do backfill da migration 052).
 *
 * Deve rodar APÓS `authMiddleware`.
 */
async function resolveUserAccountProfile(req, res, next) {
  try {
    const id_user = req.user?.id_user;
    if (!id_user) return res.status(401).json({ error: "Não autenticado" });

    const id_profile = await ProfileStorage.getUserAccountProfileId(pool, id_user);
    if (!id_profile) {
      return res.status(500).json({ error: "Não foi possível resolver o perfil do usuário" });
    }
    req.params.id_profile = id_profile;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = resolveUserAccountProfile;
