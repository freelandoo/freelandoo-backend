const pool = require("../databases");
const UserPublicSummaryStorage = require("../storages/UserPublicSummaryStorage");
const EntityFollowStorage = require("../storages/EntityFollowStorage");
const XpStorage = require("../storages/XpStorage");

class UserPublicController {
  static async accountSummary(req, res) {
    const handle = String(req.params.handle || "").replace(/^@/, "").trim();
    if (!handle) {
      return res.status(400).json({ error: "handle obrigatorio" });
    }
    const id_user = await UserPublicSummaryStorage.findUserIdByUsername(pool, handle);
    if (!id_user) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }
    const [profiles_count, clans_count, courses, accountProfile] = await Promise.all([
      UserPublicSummaryStorage.countPublicProfiles(pool, id_user),
      UserPublicSummaryStorage.countPublicClans(pool, id_user),
      UserPublicSummaryStorage.listPublishedCourses(pool, id_user, 12),
      UserPublicSummaryStorage.getAccountProfile(pool, id_user),
    ]);

    // Paridade user≡subperfil: o perfil-conta expõe XP/nível, seguidores e
    // redes sociais — igual a um subperfil.
    let account = null;
    if (accountProfile) {
      const [xp, followCounts, social_media] = await Promise.all([
        XpStorage.getXpSummary(pool, accountProfile.id_profile),
        EntityFollowStorage.counts(pool, {
          entity_type: "profile",
          entity_id: accountProfile.id_profile,
        }),
        UserPublicSummaryStorage.listSocialMedia(pool, accountProfile.id_profile),
      ]);
      account = {
        id_profile: accountProfile.id_profile,
        xp_total: Number(accountProfile.xp_total) || 0,
        xp_level: Number(accountProfile.xp_level) || 0,
        xp_progress_percent: xp?.xp_progress_percent ?? 0,
        followers_count: Number(followCounts?.followers_count) || 0,
        following_count: Number(followCounts?.following_count) || 0,
        social_media,
      };
    }

    return res.json({ profiles_count, clans_count, courses, account });
  }
}

module.exports = UserPublicController;
