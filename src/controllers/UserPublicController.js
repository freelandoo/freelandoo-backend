const pool = require("../databases");
const UserPublicSummaryStorage = require("../storages/UserPublicSummaryStorage");

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
    const [profiles_count, clans_count, courses] = await Promise.all([
      UserPublicSummaryStorage.countPublicProfiles(pool, id_user),
      UserPublicSummaryStorage.countPublicClans(pool, id_user),
      UserPublicSummaryStorage.listPublishedCourses(pool, id_user, 12),
    ]);
    return res.json({ profiles_count, clans_count, courses });
  }
}

module.exports = UserPublicController;
