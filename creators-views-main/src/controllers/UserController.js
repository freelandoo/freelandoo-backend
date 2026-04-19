const pool = require("../databases");
const GetMeService = require("../services/user/GetMeService");
const GetCreatorService = require("../services/user/GetCreatorService");
const UpdateMeService = require("../services/user/UpdateMeService");
const UpdateAvatarService = require("../services/user/UpdateAvatarService");

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
}

module.exports = UserController;
