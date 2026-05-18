const pool = require("../databases");
const GetMeService = require("../services/user/GetMeService");
const GetCreatorService = require("../services/user/GetCreatorService");
const UpdateMeService = require("../services/user/UpdateMeService");
const UpdateAvatarService = require("../services/user/UpdateAvatarService");
const DeleteMeService = require("../services/user/DeleteMeService");
const ExportMeService = require("../services/user/ExportMeService");
const UpdatePreferredLocaleService = require("../services/user/UpdatePreferredLocaleService");
const UpdatePreferredCountryService = require("../services/user/UpdatePreferredCountryService");

class UserController {
  static async me(req, res) {
    const { id_user } = req.user;
    const user = await GetMeService.execute({ db: pool, id_user });
    return res.json(user);
  }

  static async creator(req, res) {
    const { id } = req.params;
    const user = await GetCreatorService.execute({ db: pool, id_user: id });
    return res.json(user);
  }

  static async updateMe(req, res) {
    const { id_user } = req.user;
    const updated = await UpdateMeService.execute({
      db: pool,
      id_user,
      patch: req.body,
    });
    return res.json(updated);
  }

  static async updateAvatar(req, res) {
    const { id_user } = req.user;
    const updated = await UpdateAvatarService.execute({
      db: pool,
      id_user,
      file: req.file,
    });
    return res.json(updated);
  }

  static async deleteMe(req, res) {
    const { id_user } = req.user;
    const result = await DeleteMeService.execute({ db: pool, id_user });
    return res.json(result);
  }

  static async updateLocale(req, res) {
    const { id_user } = req.user;
    const { locale } = req.body || {};
    const updated = await UpdatePreferredLocaleService.execute({
      db: pool,
      id_user,
      locale,
    });
    return res.json(updated);
  }

  static async updateCountry(req, res) {
    const { id_user } = req.user;
    const { country } = req.body || {};
    const updated = await UpdatePreferredCountryService.execute({
      db: pool,
      id_user,
      country,
    });
    return res.json(updated);
  }

  static async exportMe(req, res) {
    const { id_user } = req.user;
    const data = await ExportMeService.execute({ db: pool, id_user });
    res.setHeader("Content-Disposition", `attachment; filename="freelandoo-dados-${id_user}.json"`);
    res.setHeader("Content-Type", "application/json");
    return res.json(data);
  }
}

module.exports = UserController;
