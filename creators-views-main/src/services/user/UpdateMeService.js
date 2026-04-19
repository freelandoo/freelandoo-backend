// src/services/user/UpdateMeService.js
const UserStorage = require("../../storages/UserStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("UpdateMeService");

module.exports = class UpdateMeService {
  static async execute({ db, id_user, patch }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user, keys: patch ? Object.keys(patch) : [] }),
      async () => {
        const updated = await UserStorage.updateUserById(db, id_user, patch);

        if (!updated) {
          const err = new Error("Nenhum campo para atualizar");
          err.statusCode = 400;
          throw err;
        }

        return updated;
      }
    );
  }
};
