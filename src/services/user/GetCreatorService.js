// src/services/user/GetCreatorService.js
const UserStorage = require("../../storages/UserStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("GetCreatorService");

module.exports = class GetCreatorService {
  static async execute({ db, id_user }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user }),
      async () => {
        const user = await UserStorage.getUserWithSocialById(db, id_user);
        if (!user) {
          const err = new Error("Usuário não encontrado");
          err.statusCode = 404;
          throw err;
        }
        return user;
      }
    );
  }
};
